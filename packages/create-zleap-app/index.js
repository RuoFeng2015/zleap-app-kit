#!/usr/bin/env node
// create-zleap-app：一条命令生成可直接部署到 zleapOS 的云开发应用。
//
//   npm create zleap-app@latest my-app
//   npx create-zleap-app my-app --appid zl3f9a2c7e1b0d4a68 --name "我的应用" -y
//   npx create-zleap-app@latest skills [目录]      给已有项目补装 AI 编程工具 skills
//   npx create-zleap-app@latest scripts [目录]     给已有项目更新部署脚本 scripts/zleap.mjs
//
// appid 由平台生成：先在 zleapOS 云开发控制台「创建应用」，复制 appid。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  BUILD_TEMPLATES,
  TEMPLATES,
  detectPackageManager,
  installSkills,
  packageManagerFiles,
  runScriptCommand,
  isEmptyDir,
  nodeVersionProblem,
  parseArgs,
  scaffold,
  updateScripts,
  toPackageName,
  validateName,
  validateOptionalAppId,
} from './lib/scaffold.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const kit = pkg.zleapKit;

const color = (code) => (text) => (process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = color('1');
const green = color('32');
const cyan = color('36');
const dim = color('2');
const red = color('31');

const HELP = `
${bold('create-zleap-app')} ${dim(`v${pkg.version}`)} — 创建 zleapOS 云开发应用

用法
  npm create zleap-app@latest [目录] [-- 选项]
  npx create-zleap-app [目录] [选项]
  npx create-zleap-app@latest skills [目录]   给已有项目补装 AI 编程工具 skills（默认当前目录）
  npx create-zleap-app@latest scripts [目录]  给已有项目更新部署脚本 scripts/zleap.mjs（npm run deploy 等），原文件备份为 .bak

选项
  --appid <appid>   已有应用的 appid（形如 zl3f9a2c7e1b0d4a68）；不填时第一次 npm run login 会在授权时自动新建应用
  --name <名称>     应用显示名称
  --template <名>   模板：react-ts（React + TS + Vite，默认）/ vanilla（原生 HTML/JS，不用构建，装得快）
  --target <URL>    zleapOS 地址，写入项目配置，之后 npm run login 不再询问
  --pm <名>         包管理器：npm / pnpm / yarn / bun（默认跟随调用方）
  --no-install      不安装依赖
  --no-skills       不在项目里安装 AI 编程工具 skills
  --no-git          不初始化 git 仓库
  -y, --yes         全部使用默认值，不提问
  -h, --help        显示帮助
`;

async function prompt(rl, question, fallback, validate) {
  for (;;) {
    const raw = (await rl.question(`${cyan('?')} ${question}${fallback ? dim(` (${fallback})`) : ''} `)).trim();
    const value = raw || fallback;
    const problem = validate ? validate(value) : null;
    if (!problem) return value;
    console.log(red(`  ${problem}`));
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  return result.status === 0;
}

/** 已有项目补装 skills：复制随包分发的 skills 到 .agents/skills 与 .claude/skills，不改动其他文件。 */
function addSkills(dir) {
  const targetDir = resolve(dir ?? '.');
  if (!existsSync(targetDir)) throw new Error(`目录 ${dir} 不存在`);
  const names = installSkills({ skillsDir: join(here, 'skills'), targetDir });
  if (!names.length) throw new Error('这个版本的 create-zleap-app 没有随附 skills');
  console.log(green(`✔ 已在 ${targetDir} 安装 skills：${names.join(', ')}（.agents/skills、.claude/skills）`));
  console.log(dim('  在 Codex / Claude Code / Pi / OpenCode / Cursor 里打开这个目录即可使用；升级 skills 时重新运行本命令。'));
}

/** 已有项目更新 scripts/zleap.mjs：只动这一个文件，原文件不同则备份为 .bak。 */
function refreshScripts(dir) {
  const targetDir = resolve(dir ?? '.');
  if (!existsSync(join(targetDir, 'package.json'))) throw new Error(`${targetDir} 不是项目目录（没有 package.json）`);
  const result = updateScripts({ sharedDir: join(here, 'templates', '_shared'), targetDir });
  const label = { created: '已生成', updated: '已更新（原文件备份为 scripts/zleap.mjs.bak）', unchanged: '已是最新，无需更新' }[result];
  console.log(green(`✔ scripts/zleap.mjs ${label}（create-zleap-app v${pkg.version}）`));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'skills') {
    const rest = parseArgs(argv.slice(1));
    if (rest.help) return console.log(HELP);
    return addSkills(rest.dir);
  }
  if (argv[0] === 'scripts') {
    const rest = parseArgs(argv.slice(1));
    if (rest.help) return console.log(HELP);
    return refreshScripts(rest.dir);
  }
  const options = parseArgs(argv);
  if (options.help) return console.log(HELP);
  if (options.version) return console.log(pkg.version);
  if (!TEMPLATES.includes(options.template)) throw new Error(`未知模板：${options.template}（可选 ${TEMPLATES.join(' / ')}）`);
  // 生成器本身在旧 Node 上也能跑，但构建型模板生成的项目构建不了：先说清楚，不中断（用户可能稍后再升级）。
  const nodeProblem = BUILD_TEMPLATES.includes(options.template) ? nodeVersionProblem() : null;
  if (nodeProblem) console.log(red(`! ${nodeProblem}`));

  const interactive = process.stdin.isTTY && !options.yes;
  const rl = interactive ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    let dir = options.dir;
    if (!dir) dir = rl ? await prompt(rl, '项目目录', 'my-zleap-app') : 'my-zleap-app';
    const targetDir = resolve(dir);
    if (!isEmptyDir(targetDir)) throw new Error(`目录 ${dir} 不是空目录，为避免覆盖请换一个目录`);

    let appid = options.appid;
    if (!appid && rl) {
      console.log(dim('  已有应用就粘贴它的 appid；留空则在第一次 npm run login 授权时自动新建应用。'));
      appid = await prompt(rl, 'appid（可留空）', '', validateOptionalAppId);
    }
    const idProblem = validateOptionalAppId(appid);
    if (idProblem) throw new Error(`${idProblem}\n  用法：npm create zleap-app@latest ${dir} -- --appid <appid>（或不带 --appid，登录时自动新建应用）`);

    let name = options.name;
    if (!name) name = rl ? await prompt(rl, '应用名称', toPackageName(dir), validateName) : toPackageName(dir);
    const nameProblem = validateName(name);
    if (nameProblem) throw new Error(nameProblem);
    rl?.close();
    // 发布时应用名以 manifest.json 的 name 为准：非交互又没给 --name 时，名字是目录名，发布后控制台里的应用名会被改掉。
    if (!options.name && !rl)
      console.log(red(`! 没有提供 --name，应用名称暂用目录名「${name}」。发布时应用名以 manifest.json 的 name 为准，请改成控制台里的应用名（或重新生成时加 --name "应用名"）`));

    console.log(`\n在 ${cyan(targetDir)} 创建 ${bold(name)}（${appid || '登录时新建应用'}）`);
    scaffold({
      templateDir: join(here, 'templates', options.template),
      targetDir,
      appid,
      name,
      packageName: toPackageName(dir),
      cliPackage: kit.cliPackage,
      cliVersion: kit.cliVersion,
      sdkPackage: kit.sdkPackage,
      sdkVersion: kit.sdkVersion,
    });
    console.log(green('✔ 项目文件已生成'));

    if (options.target) {
      mkdirSync(join(targetDir, '.zleap'), { recursive: true });
      writeFileSync(join(targetDir, '.zleap', 'config.json'), `${JSON.stringify({ target: options.target }, null, 2)}\n`);
    }

    if (options.skills) {
      const names = installSkills({ skillsDir: join(here, 'skills'), targetDir });
      if (names.length) console.log(green(`✔ 已为 AI 编程工具安装 skills：${names.join(', ')}（.agents/skills、.claude/skills）`));
    }

    if (options.git && !existsSync(join(targetDir, '.git'))) {
      const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: targetDir, encoding: 'utf8' });
      if (inside.status !== 0 && run('git', ['init', '-q'], targetDir)) console.log(green('✔ 已初始化 git 仓库'));
    }

    const pm = options.pm || detectPackageManager();
    for (const [name, content] of Object.entries(packageManagerFiles(pm))) {
      if (!existsSync(join(targetDir, name))) writeFileSync(join(targetDir, name), content);
    }
    let installed = false;
    if (options.install) {
      console.log(`\n使用 ${pm} 安装依赖…`);
      installed = run(pm, ['install'], targetDir);
      if (!installed) console.log(red(`依赖安装失败，可以稍后在项目目录手动运行 ${pm} install`));
    }

    const cd = relative(process.cwd(), targetDir) || '.';

    console.log(`
${bold('完成！接下来：')}

  cd ${cd}${installed ? '' : `\n  ${pm} install`}
  ${runScriptCommand(pm, 'login', options.target ? '' : '--target https://你的-os-地址')}   ${dim(appid ? '# 浏览器授权' : '# 浏览器授权，同时新建应用')}
  ${runScriptCommand(pm, 'deploy')}                                         ${dim(BUILD_TEMPLATES.includes(options.template) ? '# 构建→检查→上传→装到你的桌面' : '# 检查→上传→装到你的桌面（不用构建）')}

  然后从 zleapOS 启动台打开应用（开发环境与数据库在安装时自动开通）。

${bold('让 AI 编程工具帮你开发')}
  ${options.skills ? '项目里已带 AGENTS.md、skills 和 MCP 配置' : '项目里已带 AGENTS.md 和 MCP 配置（按 --no-skills 没有安装 skills）'}（.mcp.json、.cursor/mcp.json），直接在 Claude Code / Cursor / Codex / OpenCode 里打开本目录即可。
  AI 会先通过 MCP 查清你账号下可用的 OS 接口与 SDK，没有的再用云函数补充。
  ${options.skills ? '已有项目补装' : '需要时补装'} skills：${cyan('npx create-zleap-app@latest skills')}
`);
  } finally {
    rl?.close();
  }
}

main().catch((error) => {
  console.error(red(`✖ ${error.message}`));
  process.exitCode = 1;
});
