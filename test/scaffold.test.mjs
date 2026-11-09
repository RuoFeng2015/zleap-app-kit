import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  detectPackageManager,
  installSkills,
  isEmptyDir,
  nodeVersionProblem,
  packageManagerFiles,
  parseArgs,
  runScriptCommand,
  scaffold,
  toAppKeySegment,
  toPackageName,
  validateAppId,
  validateAppKey,
  validateName,
  validateOptionalAppId,
} from '../packages/create-zleap-app/lib/scaffold.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const templateDir = join(root, 'packages/create-zleap-app/templates/react-ts');

test('app_key 校验与服务端规则一致', () => {
  for (const ok of ['com.example.todo', 'com.example.my-app', 'com.example.my_app', 'org.acme.notes2']) {
    assert.equal(validateAppKey(ok), null, ok);
  }
  for (const bad of ['', 'mytodo', 'Com.Example.Todo', 'com.example.-app', 'com.example.2notes', `com.${'a'.repeat(70)}`]) {
    assert.notEqual(validateAppKey(bad), null, bad);
  }
});

test('appid：平台 appid 优先，旧命名空间仍可用', () => {
  for (const ok of ['zl3f9a2c7e1b0d4a68', 'com.example.todo']) assert.equal(validateAppId(ok), null, ok);
  for (const bad of ['', 'zl3f9a2c7e1b0d4a6', 'ZL3F9A2C7E1B0D4A68', 'mytodo']) assert.notEqual(validateAppId(bad), null, bad);
});

test('名称与目录推导', () => {
  assert.equal(validateName('  '), '应用名称不能为空');
  assert.equal(toPackageName('/tmp/My App!'), 'my-app');
  assert.equal(toAppKeySegment('/tmp/2nd Todo'), 'nd-todo');
  assert.equal(toAppKeySegment('/tmp/123'), 'app');
});

test('参数解析', () => {
  const parsed = parseArgs(['demo', '--appid=zl3f9a2c7e1b0d4a68', '--name', '演示', '--no-install', '-y', '--pm', 'pnpm']);
  assert.equal(parsed.dir, 'demo');
  assert.equal(parsed.appid, 'zl3f9a2c7e1b0d4a68');
  assert.equal(parseArgs(['--app-key', 'com.a.b']).appid, 'com.a.b', '旧参数名等价于 --appid');
  assert.equal(parsed.name, '演示');
  assert.equal(parsed.install, false);
  assert.equal(parsed.yes, true);
  assert.equal(parsed.pm, 'pnpm');
  assert.throws(() => parseArgs(['--bogus']), /未知参数/);
});

test('包管理器跟随调用方', () => {
  assert.equal(detectPackageManager('pnpm/9.0.0 npm/? node/v22'), 'pnpm');
  assert.equal(detectPackageManager('yarn/4.0.0'), 'yarn');
  assert.equal(detectPackageManager(''), 'npm');
});

test('生成项目：占位符全部替换，JSON/HTML 正确转义，skills 装到两个目录', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'zleap-scaffold-')), 'app');
  assert.equal(isEmptyDir(dir), true);
  scaffold({
    templateDir,
    targetDir: dir,
    appid: 'zl3f9a2c7e1b0d4a68',
    name: '带"引号"<和尖括号>',
    packageName: 'app',
    cliPackage: '@zleap-ai/app-cli',
    cliVersion: '0.10.0',
    sdkPackage: '@zleap-ai/app-sdk',
    sdkVersion: '0.10.0',
    year: 2026,
  });
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.appid, 'zl3f9a2c7e1b0d4a68');
  assert.equal(manifest.app_key, undefined, '新项目只写 appid');
  assert.equal(manifest.publisher, undefined, '不再需要 publisher');
  assert.equal(manifest.name, '带"引号"<和尖括号>');
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'app');
  assert.equal(pkg.devDependencies['@zleap-ai/app-cli'], '^0.10.0');
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /<title>带&quot;引号&quot;&lt;和尖括号&gt;<\/title>/);
  assert.match(readFileSync(join(dir, 'LICENSE'), 'utf8'), /Copyright \(c\) 2026/);
  assert.ok(existsSync(join(dir, '.gitignore')));
  assert.ok(!existsSync(join(dir, '_gitignore')));
  assert.equal(pkg.dependencies['@zleap-ai/app-sdk'], '^0.10.0');
  assert.ok(!existsSync(join(dir, 'src/zleap-sdk')), '可读 SDK 不应再随模板分发');
  assert.match(readFileSync(join(dir, 'src/cloud/client.ts'), 'utf8'), /from '@zleap-ai\/app-sdk'/);
  for (const file of ['package.json', 'manifest.json', 'index.html', 'README.md', 'AGENTS.md', 'LICENSE', 'src/App.tsx']) {
    assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /__[A-Z_]+__/, file);
  }
  assert.equal(isEmptyDir(dir), false);

  const names = installSkills({ skillsDir: join(root, 'skills'), targetDir: dir });
  assert.deepEqual(names.sort(), ['zleap-cloud-app', 'zleap-cloud-app-release']);
  for (const target of ['.agents/skills', '.claude/skills']) {
    assert.deepEqual(readdirSync(join(dir, target)).sort(), names);
    assert.ok(existsSync(join(dir, target, 'zleap-cloud-app/references/manifest.md')));
  }
});

test('模板 manifest 是合法的 zleap.app/2 最小应用', () => {
  const raw = readFileSync(join(templateDir, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(raw);
  assert.equal(manifest.schema, 'zleap.app/2');
  assert.equal(manifest.execution, 'foreground');
  assert.equal(manifest.runtime.ui.entry, 'index.html');
  assert.deepEqual(manifest.data.collections, ['todos']);
  assert.equal(manifest.data.schemas.todos.additionalProperties, false);
});

test('Node.js 版本：与生成项目的 Vite 7 要求一致', () => {
  for (const ok of ['20.19.0', '20.20.1', '22.12.0', '22.21.1', '24.11.0', 'v26.0.0']) assert.equal(nodeVersionProblem(ok), null, ok);
  for (const bad of ['18.20.4', '20.18.3', '21.7.3', '22.11.0']) assert.match(nodeVersionProblem(bad), /20\.19\+ 或 22\.12\+/, bad);
  const engines = JSON.parse(readFileSync(join(templateDir, 'package.json'), 'utf8')).engines?.node;
  assert.equal(engines, '^20.19.0 || >=22.12.0');
});

test('skills 子命令：给已有项目补装 skills，不动其他文件', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zleap-skills-'));
  const result = spawnSync(process.execPath, [join(root, 'packages/create-zleap-app/index.js'), 'skills', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  for (const target of ['.agents/skills', '.claude/skills']) {
    assert.ok(existsSync(join(dir, target, 'zleap-cloud-app', 'SKILL.md')), target);
    assert.ok(existsSync(join(dir, target, 'zleap-cloud-app-release', 'SKILL.md')), target);
  }
  assert.deepEqual(readdirSync(dir).sort(), ['.agents', '.claude']);
  const missing = spawnSync(process.execPath, [join(root, 'packages/create-zleap-app/index.js'), 'skills', join(dir, 'nope')], { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
});

test('vanilla 模板：应用在 app/，共用部署脚本，占位符全部替换，不需要构建工具', () => {
  const targetDir = join(mkdtempSync(join(tmpdir(), 'zleap-vanilla-')), 'notes');
  scaffold({
    templateDir: join(root, 'packages/create-zleap-app/templates/vanilla'),
    targetDir,
    appid: 'zl0123456789abcdef',
    name: '我的"笔记"',
    packageName: 'notes',
    cliPackage: '@zleap-ai/app-cli',
    cliVersion: '0.11.0',
    sdkPackage: '@zleap-ai/app-sdk',
  });
  for (const rel of ['app/manifest.json', 'app/index.html', 'app/main.js', 'app/style.css', 'app/LICENSE', 'scripts/zleap.mjs', 'AGENTS.md', 'CLAUDE.md', '.gitignore', 'package.json']) {
    assert.ok(existsSync(join(targetDir, rel)), rel);
  }
  const manifest = JSON.parse(readFileSync(join(targetDir, 'app/manifest.json'), 'utf8'));
  assert.equal(manifest.appid, 'zl0123456789abcdef');
  assert.equal(manifest.name, '我的"笔记"');
  assert.match(readFileSync(join(targetDir, 'app/index.html'), 'utf8'), /我的&quot;笔记&quot;/);
  const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.zleap, { packageDir: 'app', build: false, sdkDir: 'app/sdk' });
  assert.deepEqual(Object.keys(pkg.dependencies), ['@zleap-ai/app-sdk']);
  assert.deepEqual(Object.keys(pkg.devDependencies), ['@zleap-ai/app-cli']);
  assert.ok(!existsSync(join(targetDir, 'vite.config.ts')));
  assert.match(readFileSync(join(targetDir, '.gitignore'), 'utf8'), /app\/sdk/);
  // 两个模板用同一份部署脚本
  const react = join(mkdtempSync(join(tmpdir(), 'zleap-react-')), 'r');
  scaffold({ templateDir, targetDir: react, appid: 'zl0123456789abcdef', name: 'r', packageName: 'r', cliPackage: '@zleap-ai/app-cli', cliVersion: '0.11.0', sdkPackage: '@zleap-ai/app-sdk' });
  assert.equal(readFileSync(join(react, 'scripts/zleap.mjs'), 'utf8'), readFileSync(join(targetDir, 'scripts/zleap.mjs'), 'utf8'));
  assert.deepEqual(JSON.parse(readFileSync(join(react, 'package.json'), 'utf8')).zleap, { packageDir: 'dist' });
});

test('参数解析：--template vanilla', () => {
  assert.equal(parseArgs(['my-app', '--template', 'vanilla']).template, 'vanilla');
});

test('appid 可留空，两个模板都带 MCP 配置（不写死部署地址）', () => {
  for (const template of ['react-ts', 'vanilla']) {
    const dir = join(mkdtempSync(join(tmpdir(), 'zleap-noid-')), 'a');
    scaffold({ templateDir: join(root, 'packages/create-zleap-app/templates', template), targetDir: dir, name: 'a', packageName: 'a', cliPackage: '@zleap-ai/app-cli', cliVersion: '0.12.0', sdkPackage: '@zleap-ai/app-sdk' });
    const manifest = JSON.parse(readFileSync(join(dir, template === 'vanilla' ? 'app/manifest.json' : 'manifest.json'), 'utf8'));
    assert.equal(manifest.appid, '');
    for (const rel of ['.mcp.json', '.cursor/mcp.json']) {
      const config = JSON.parse(readFileSync(join(dir, rel), 'utf8'));
      assert.deepEqual(config.mcpServers['zleap-app'], { command: 'npx', args: ['zleap-app', 'mcp', 'serve', '--workspace', '.'] }, rel);
    }
  }
  assert.equal(validateOptionalAppId(''), null);
  assert.notEqual(validateOptionalAppId('bad'), null);
});

test('runScriptCommand：非 npm 一律带 run，避免撞上 pnpm deploy / pnpm login / yarn login 内置命令', () => {
  assert.equal(runScriptCommand('npm', 'deploy'), 'npm run deploy');
  assert.equal(runScriptCommand('npm', 'login', '--target https://os.example.com'), 'npm run login -- --target https://os.example.com');
  for (const pm of ['pnpm', 'yarn', 'bun']) {
    assert.equal(runScriptCommand(pm, 'deploy'), `${pm} run deploy`);
    assert.equal(runScriptCommand(pm, 'login', '--target https://os.example.com'), `${pm} run login --target https://os.example.com`);
  }
});

test('完成提示：--pm pnpm 给出可执行的脚本命令；--no-skills 不再声称已带 skills', () => {
  const cli = join(root, 'packages/create-zleap-app/index.js');
  const cwd = mkdtempSync(join(tmpdir(), 'czapp-hint-'));
  const pnpm = spawnSync(process.execPath, [cli, 'p', '--pm', 'pnpm', '--no-install', '--no-git', '-y'], { cwd, encoding: 'utf8' });
  assert.equal(pnpm.status, 0, pnpm.stderr);
  assert.match(pnpm.stdout, /pnpm run login --target /);
  assert.match(pnpm.stdout, /pnpm run deploy/);
  assert.doesNotMatch(pnpm.stdout, /pnpm (login|deploy)\b/);
  assert.match(pnpm.stdout, /已带 AGENTS\.md、skills/);
  const bare = spawnSync(process.execPath, [cli, 'q', '--no-install', '--no-git', '--no-skills', '-y'], { cwd, encoding: 'utf8' });
  assert.equal(bare.status, 0, bare.stderr);
  assert.ok(!existsSync(join(cwd, 'q/.agents/skills')));
  assert.doesNotMatch(bare.stdout, /已带 AGENTS\.md、skills/);
  assert.match(bare.stdout, /没有安装 skills/);
});

test('包管理器配置：yarn 用 node_modules 布局、pnpm 放行 esbuild 构建脚本，npm 不写；已有文件不覆盖', () => {
  assert.deepEqual(packageManagerFiles('npm'), {});
  assert.match(packageManagerFiles('yarn')['.yarnrc.yml'], /^nodeLinker: node-modules$/m);
  assert.match(packageManagerFiles('pnpm')['pnpm-workspace.yaml'], /allowBuilds:\n  esbuild: true/);
  const cli = join(root, 'packages/create-zleap-app/index.js');
  const cwd = mkdtempSync(join(tmpdir(), 'czapp-pm-'));
  for (const pm of ['yarn', 'pnpm', 'npm']) {
    const r = spawnSync(process.execPath, [cli, pm, '--pm', pm, '--no-install', '--no-git', '--no-skills', '-y'], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  }
  assert.equal(readFileSync(join(cwd, 'yarn/.yarnrc.yml'), 'utf8'), 'nodeLinker: node-modules\n');
  assert.ok(existsSync(join(cwd, 'pnpm/pnpm-workspace.yaml')));
  assert.ok(!existsSync(join(cwd, 'npm/.yarnrc.yml')) && !existsSync(join(cwd, 'npm/pnpm-workspace.yaml')));
});
