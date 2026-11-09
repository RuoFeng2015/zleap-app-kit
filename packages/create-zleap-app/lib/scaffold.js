// 项目生成的纯逻辑：参数解析、命名校验、模板复制与占位符替换、skills 安装。
// 不依赖第三方包，便于 npx 秒开，也便于单元测试。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

/** 平台生成的 appid（云开发控制台「创建应用」得到），与服务端 pkg/appid.Platform 一致。 */
export const APPID_PATTERN = /^zl[0-9a-f]{16}$/;

/** 旧的命名空间 app_key（com.example.todo）。服务端在清理阶段之前仍接受，只为已有应用保留。 */
export const APP_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)+$/;

/** react-ts：React + TypeScript + Vite（构建到 dist/）；vanilla：原生 HTML / JS，不用构建（应用在 app/）。 */
export const TEMPLATES = ['react-ts', 'vanilla'];

/** 需要 Vite 7 的模板（对 Node.js 版本有要求）。 */
export const BUILD_TEMPLATES = ['react-ts'];

/** 需要做占位符替换的文本文件（相对模板根目录）。 */
const SUBSTITUTED = ['package.json', 'manifest.json', 'index.html', 'LICENSE', 'README.md', 'AGENTS.md', 'app/manifest.json', 'app/index.html', 'app/LICENSE'];

/** 为 AI 编程工具安装 skills 的项目内目录：.agents/skills 覆盖 Codex、Pi、OpenCode、Cursor、Gemini CLI、Copilot 等，.claude/skills 给 Claude Code。 */
export const SKILL_TARGETS = ['.agents/skills', '.claude/skills'];

/** 递归复制（不保留源权限位，跳过符号链接）；skip(rel) 返回 true 的路径不复制。 */
export function copyTree(from, to, skip = () => false, base = from) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    if (skip(relative(base, source))) continue;
    const target = join(to, entry.name);
    if (entry.isDirectory()) copyTree(source, target, skip, base);
    else if (entry.isFile()) copyFileSync(source, target);
  }
}

/** appid：优先平台 appid；旧命名空间 app_key 仍可用（已有应用）。 */
/** appid 可以留空：留空时 npm run login 会在授权时自动新建应用。 */
export function validateOptionalAppId(value) {
  return value ? validateAppId(value) : null;
}

export function validateAppId(value) {
  if (!value) return '请提供 appid：在 zleapOS 云开发控制台「创建应用」后复制（形如 zl3f9a2c7e1b0d4a68）';
  if (APPID_PATTERN.test(value)) return null;
  if (value.length <= 64 && APP_KEY_PATTERN.test(value)) return null;
  return 'appid 格式不对：应是 zl 开头加 16 位小写十六进制（形如 zl3f9a2c7e1b0d4a68），在云开发控制台「创建应用」后复制';
}

export function validateAppKey(value) {
  if (!value) return '请提供 app_key，例如 com.yourteam.todo';
  if (value.length > 64) return 'app_key 最长 64 个字符';
  if (!APP_KEY_PATTERN.test(value)) {
    return 'app_key 必须是带发布者前缀的小写命名空间：至少一个点，每段小写字母开头，只含小写字母、数字、- 或 _（例如 com.yourteam.todo）';
  }
  return null;
}

export function validateName(value) {
  if (!value || !value.trim()) return '应用名称不能为空';
  if ([...value].length > 64) return '应用名称最多 64 个字符';
  return null;
}

/** 目录名 → npm 包名。 */
export function toPackageName(dir) {
  const name = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '');
  return name || 'zleap-app';
}

/** 目录名 → app_key 最后一段。 */
export function toAppKeySegment(dir) {
  const segment = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-+$/, '');
  return segment || 'app';
}

/** 生成的项目用 Vite 7，要求的 Node.js 版本；与模板 package.json 的 engines 保持一致。 */
export const SUPPORTED_NODE = '^20.19.0 || >=22.12.0';

/** 当前 Node.js 能否构建生成的项目：能则返回 null，否则返回给人看的说明。 */
export function nodeVersionProblem(version = process.versions.node) {
  const [major, minor] = String(version).replace(/^v/, '').split('.').map(Number);
  if (major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19)) return null;
  return `当前 Node.js ${version} 无法构建生成的项目（Vite 7 需要 Node.js 20.19+ 或 22.12+）。请先升级 Node.js，例如 nvm install 22，或到 https://nodejs.org 下载 LTS 版本。`;
}

export function parseArgs(argv) {
  const out = { install: true, skills: true, git: true, yes: false, help: false, version: false, template: 'react-ts' };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') ? arg.split(/=(.*)/s) : [arg];
    const value = () => (inline !== undefined ? inline : argv[++i]);
    switch (flag) {
      case '--appid':
      case '--app-id':
      // --app-key 为旧参数名，等价于 --appid
      case '--app-key':
        out.appid = value();
        break;
      case '--name':
        out.name = value();
        break;
      case '--template':
      case '-t':
        out.template = value();
        break;
      case '--pm':
        out.pm = value();
        break;
      case '--target':
        out.target = value();
        break;
      case '--no-install':
        out.install = false;
        break;
      case '--no-skills':
        out.skills = false;
        break;
      case '--no-git':
        out.git = false;
        break;
      case '--yes':
      case '-y':
        out.yes = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      case '--version':
      case '-v':
        out.version = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`未知参数：${arg}`);
        positional.push(arg);
    }
  }
  out.dir = positional[0];
  return out;
}

export function detectPackageManager(userAgent = process.env.npm_config_user_agent ?? '') {
  for (const pm of ['pnpm', 'yarn', 'bun']) if (userAgent.startsWith(`${pm}/`)) return pm;
  return 'npm';
}

/**
 * 包管理器专用配置，生成项目时写入（已存在则不覆盖），让项目装完依赖即可用：
 * - yarn 4 默认 Plug'n'Play，没有 node_modules/.bin：scripts/zleap.mjs 与 .mcp.json 里的 npx zleap-app 都找不到 CLI；
 * - pnpm 10 起默认拦截依赖的构建脚本，pnpm 12 的 install 因此以非 0 退出（Vite 依赖的 esbuild 需要 postinstall），
 *   新版用 allowBuilds，旧版（10/11）用 onlyBuiltDependencies，两个都写。
 * 全流程测试 e6-11091657-468 PKG-07。
 */
export function packageManagerFiles(pm) {
  if (pm === 'yarn') return { '.yarnrc.yml': 'nodeLinker: node-modules\n' };
  if (pm === 'pnpm') return { 'pnpm-workspace.yaml': 'allowBuilds:\n  esbuild: true\nonlyBuiltDependencies:\n  - esbuild\n' };
  return {};
}

/**
 * 「接下来」里运行项目脚本的命令。一律带 run：`pnpm deploy`、`pnpm login`、`yarn login` 是包管理器自己的内置命令
 * （工作区部署 / 登录 npm 仓库），不会执行项目里的 deploy、login 脚本。npm 需要 `--` 才把参数交给脚本，其余直接跟在后面。
 */
export function runScriptCommand(pm, script, args = '') {
  if (pm === 'npm') return `npm run ${script}${args ? ` -- ${args}` : ''}`;
  return `${pm} run ${script}${args ? ` ${args}` : ''}`;
}

export function isEmptyDir(dir) {
  if (!existsSync(dir)) return true;
  if (!statSync(dir).isDirectory()) return false;
  return readdirSync(dir).filter((name) => name !== '.git' && name !== '.DS_Store').length === 0;
}

const escapeHTML = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 复制模板并替换占位符。返回写入的文件数。 */
export function scaffold({ templateDir, targetDir, appid, appKey, name, packageName, cliPackage, cliVersion, sdkPackage, sdkVersion = cliVersion, year = new Date().getFullYear() }) {
  const skip = (rel) => /(^|[\\/])(node_modules|dist|out|\.zleap)([\\/]|$)/.test(rel);
  copyTree(templateDir, targetDir, skip);
  // 各模板共用的文件（部署脚本 scripts/zleap.mjs）只维护一份，放在 templates/_shared。
  const shared = join(dirname(templateDir), '_shared');
  if (existsSync(shared)) copyTree(shared, targetDir, skip);
  if (existsSync(join(targetDir, '_gitignore'))) renameSync(join(targetDir, '_gitignore'), join(targetDir, '.gitignore'));

  const replacements = {
    __APPID__: appid ?? appKey ?? '',
    __APP_NAME__: name,
    __PKG_NAME__: packageName,
    __CLI_PACKAGE__: cliPackage,
    __CLI_VERSION__: cliVersion,
    __SDK_PACKAGE__: sdkPackage,
    __SDK_VERSION__: sdkVersion,
    __YEAR__: String(year),
  };
  for (const rel of SUBSTITUTED) {
    const file = join(targetDir, rel);
    if (!existsSync(file)) continue;
    let text = readFileSync(file, 'utf8');
    for (const [key, value] of Object.entries(replacements)) {
      // JSON 文件里的值需要按 JSON 字符串转义（应用名可能包含引号）
      const safe = rel.endsWith('.json') ? JSON.stringify(value).slice(1, -1) : rel.endsWith('.html') ? escapeHTML(value) : value;
      text = text.split(key).join(safe);
    }
    writeFileSync(file, text);
  }
  const leftover = SUBSTITUTED.filter((rel) => existsSync(join(targetDir, rel)) && /__[A-Z_]+__/.test(readFileSync(join(targetDir, rel), 'utf8')));
  if (leftover.length) throw new Error(`模板占位符未替换完整：${leftover.join(', ')}`);
}

/** 把随包分发的 skills 复制到项目内各 AI 工具的 skills 目录。返回安装的 skill 名称。 */
export function installSkills({ skillsDir, targetDir }) {
  if (!existsSync(skillsDir)) return [];
  const names = readdirSync(skillsDir).filter((name) => existsSync(join(skillsDir, name, 'SKILL.md')));
  for (const target of SKILL_TARGETS) {
    for (const name of names) {
      copyTree(join(skillsDir, name), join(targetDir, target, name));
    }
  }
  return names;
}
