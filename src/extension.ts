import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as https from 'https';

interface SkillsConfig {
  skillPaths: string[];
}

interface RepoConfig {
  repos: string[];
}

interface GithubTreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new SkillsHubViewProvider(context.extensionUri, context.globalStorageUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('skillsHubView', provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('skillsHub.openView', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.skillsHubSidebar');
    })
  );
}

export function deactivate() {
}

class SkillsHubViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly globalStorageUri: vscode.Uri
  ) {}

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      switch (message.command) {
        case 'loadState':
          return webviewView.webview.postMessage({
            command: 'state',
            data: await this.loadState()
          });
        case 'saveSkillConfig':
          await this.writeConfig(message.data);
          return webviewView.webview.postMessage({ command: 'state', data: await this.loadState() });
        case 'saveRepoConfig':
          await this.writeRepoConfig(message.data);
          return webviewView.webview.postMessage({ command: 'state', data: await this.loadState() });
        case 'refreshInstalled':
          return webviewView.webview.postMessage({
            command: 'installedSkills',
            data: await this.loadInstalledSkills(message.data.skillPaths)
          });
        case 'refreshMarketplace':
          return webviewView.webview.postMessage({
            command: 'marketplaceSkills',
            data: await this.loadMarketplaceSkills(message.data.repos)
          });
      }
    });
  }

  private getConfigFolder(): vscode.Uri {
    return vscode.Uri.file(path.join(os.homedir(), 'SkillsHub', 'config'));
  }

  private getConfigFile(): vscode.Uri {
    const configFolder = this.getConfigFolder();
    return vscode.Uri.file(path.join(configFolder.fsPath, 'config.json'));
  }

  private getRepoConfigFile(): vscode.Uri {
    // Forcer la source unique claude-plugins.dev
    return vscode.Uri.file(path.join(this.extensionUri.fsPath, 'skills-hub-config', 'conf-repo.json'));
  }

  private async ensureConfigFiles() {
    const configFolder = this.getConfigFolder();
    const configFolderFs = vscode.Uri.file(configFolder.fsPath);
    if (!fs.existsSync(configFolderFs.fsPath)) {
      fs.mkdirSync(configFolderFs.fsPath, { recursive: true });
    }

    const configPath = vscode.Uri.file(this.getConfigFile().fsPath);
    const repoPath = vscode.Uri.file(this.getRepoConfigFile().fsPath);
    this.migrateLegacyConfigIfNeeded(configPath, repoPath);

    if (!fs.existsSync(configPath.fsPath)) {
      fs.writeFileSync(configPath.fsPath, JSON.stringify({ skillPaths: [] }, null, 2), 'utf8');
    }
    if (!fs.existsSync(repoPath.fsPath)) {
      fs.writeFileSync(repoPath.fsPath, JSON.stringify({ repos: [] }, null, 2), 'utf8');
    }
  }

  private migrateLegacyConfigIfNeeded(configPath: vscode.Uri, repoPath: vscode.Uri) {
    const legacyFolders = this.getLegacyConfigFolders();
    this.copyFirstExistingLegacyFile('config.json', configPath, legacyFolders);
    this.copyFirstExistingLegacyFile('conf-repo.json', repoPath, legacyFolders);
  }

  private getLegacyConfigFolders(): vscode.Uri[] {
    const homeConfig = vscode.Uri.file(path.join(os.homedir(), 'skillsHub', 'config'));
    const kebabHomeConfig = vscode.Uri.file(path.join(os.homedir(), 'skills-hub-config'));
    const globalStorageConfig = vscode.Uri.joinPath(this.globalStorageUri, 'skills-hub-config');
    const bundledConfig = vscode.Uri.joinPath(this.extensionUri, 'skills-hub-config');
    return [homeConfig, kebabHomeConfig, globalStorageConfig, bundledConfig];
  }

  private copyFirstExistingLegacyFile(fileName: string, target: vscode.Uri, legacyFolders: vscode.Uri[]) {
    if (fs.existsSync(target.fsPath)) {
      return;
    }
    for (const folder of legacyFolders) {
      const source = vscode.Uri.file(path.join(folder.fsPath, fileName));
      if (!fs.existsSync(source.fsPath)) {
        continue;
      }
      try {
        fs.copyFileSync(source.fsPath, target.fsPath);
        return;
      } catch {
        // Ignore copy failures and fall back to default file creation.
      }
    }
  }

  private async loadState() {
    await this.ensureConfigFiles();
    const config = await this.readConfig();
    // Forcer la source unique
    const repoConfig = { repos: ['https://claude-plugins.dev/skills'] };
    const installedSkills = await this.loadInstalledSkills(config.skillPaths);
    const marketplaceSkills = await this.loadMarketplaceSkills(repoConfig.repos);
    return {
      skillPaths: config.skillPaths,
      repos: repoConfig.repos,
      configFolderPath: this.getConfigFolder().fsPath,
      installedSkills,
      marketplaceSkills
    };
  }

  private async readConfig(): Promise<SkillsConfig> {
    const file = vscode.Uri.file(this.getConfigFile().fsPath);
    try {
      const raw = fs.readFileSync(file.fsPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SkillsConfig>;
      return { skillPaths: Array.isArray(parsed.skillPaths) ? parsed.skillPaths : [] };
    } catch {
      return { skillPaths: [] };
    }
  }

  private async readRepoConfig(): Promise<RepoConfig> {
    const file = vscode.Uri.file(this.getRepoConfigFile().fsPath);
    try {
      const raw = fs.readFileSync(file.fsPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RepoConfig>;
      return { repos: Array.isArray(parsed.repos) ? parsed.repos : [] };
    } catch {
      return { repos: [] };
    }
  }

  private async writeConfig(data: SkillsConfig) {
    await this.ensureConfigFiles();
    const file = vscode.Uri.file(this.getConfigFile().fsPath);
    fs.writeFileSync(file.fsPath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async writeRepoConfig(data: RepoConfig) {
    await this.ensureConfigFiles();
    const file = vscode.Uri.file(this.getRepoConfigFile().fsPath);
    fs.writeFileSync(file.fsPath, JSON.stringify(data, null, 2), 'utf8');
  }

  private async loadInstalledSkills(skillPaths: string[]) {
    const result: { folder: string; skills: { name: string; path: string; entries: string[]; missingSkillMd: boolean }[] }[] = [];
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const rootPath = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : '';

    for (const folder of skillPaths) {
      try {
        const fullPath = path.isAbsolute(folder) ? folder : path.join(rootPath, folder);
        if (!fs.existsSync(fullPath)) {
          result.push({ folder, skills: [] });
          continue;
        }

        const skills: { name: string; path: string; entries: string[]; missingSkillMd: boolean }[] = [];
        if (fs.existsSync(path.join(fullPath, 'SKILL.md'))) {
          skills.push(this.buildSkillCard(fullPath, path.basename(fullPath), fullPath));
        }

        const entries = fs.readdirSync(fullPath, { withFileTypes: true })
          .filter((entry) => entry.isDirectory());

        for (const entry of entries) {
          const childPath = path.join(fullPath, entry.name);
          if (fs.existsSync(path.join(childPath, 'SKILL.md'))) {
            skills.push(this.buildSkillCard(childPath, entry.name, fullPath));
          }
        }

        result.push({ folder, skills });
      } catch (error) {
        result.push({ folder, skills: [] });
      }
    }
    return result;
  }

  private buildSkillCard(skillPath: string, name: string, root: string) {
    const entries: string[] = [];
    const required = 'SKILL.md';
    const skillMdPath = path.join(skillPath, required);
    const hasSkillMd = fs.existsSync(skillMdPath);

    entries.push(hasSkillMd ? required : '⚠️ SKILL.md manquant');

    const optionalDirs = ['scripts', 'references', 'assets'];
    for (const dir of optionalDirs) {
      const dirPath = path.join(skillPath, dir);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        entries.push(`${dir}/`);
        const childEntries = fs.readdirSync(dirPath).sort();
        for (const child of childEntries) {
          entries.push(`  └── ${child}`);
        }
      }
    }

    const topLevelExtras = fs.readdirSync(skillPath, { withFileTypes: true })
      .filter((entry) => entry.name !== required && !optionalDirs.includes(entry.name))
      .map((entry) => entry.name)
      .sort();

    for (const extra of topLevelExtras) {
      const extraPath = path.join(skillPath, extra);
      entries.push(fs.statSync(extraPath).isDirectory() ? `${extra}/` : extra);
    }

    return {
      name,
      path: path.relative(root, skillPath),
      entries,
      missingSkillMd: !hasSkillMd
    };
  }

  private async loadMarketplaceSkills(repos: string[]) {
    const result: { repo: string; skills: { name: string; path: string; entries: string[]; missingSkillMd: boolean }[] }[] = [];
    for (const repo of repos) {
      try {
        if (this.isClaudePluginsSource(repo)) {
          const skills = await this.loadClaudePluginsSkills(repo);
          if (!skills.length) {
            result.push({ repo, skills: [{ name: '', path: '', entries: ['Aucun skill détecté dans cette source'], missingSkillMd: true }] });
          } else {
            result.push({ repo, skills });
          }
          continue;
        }

        const parsed = this.parseGithubRepo(repo);
        if (!parsed) {
          result.push({ repo, skills: [{ name: '', path: '', entries: ['Format de repo invalide'], missingSkillMd: true }] });
          continue;
        }

        let skills = await this.findGithubSkillsFromTree(parsed.owner, parsed.name, parsed.path, parsed.ref);
        if (!skills.length) {
          skills = await this.findGithubSkills(parsed.owner, parsed.name, parsed.path, parsed.ref);
        }
        if (!skills.length) {
          result.push({ repo, skills: [{ name: '', path: '', entries: ['Aucun skill détecté dans le repo'], missingSkillMd: true }] });
        } else {
          result.push({ repo, skills });
        }
      } catch (error) {
        result.push({
          repo,
          skills: [{ name: '', path: '', entries: [this.formatGithubError(error)], missingSkillMd: true }]
        });
      }
    }
    return result;
  }

  private isClaudePluginsSource(source: string): boolean {
    return source.includes('claude-plugins.dev');
  }

  private async loadClaudePluginsSkills(source: string) {
    // Utilise l'API JSON officielle pour récupérer la liste des skills
    const apiUrl = 'https://claude-plugins.dev/api/skills';
    const raw = await this.fetchUrlText(apiUrl);
    const data = JSON.parse(raw);
    if (!data.skills || !Array.isArray(data.skills)) return [];
    return data.skills.map((skill: any) => ({
      name: skill.name,
      path: skill.namespace,
      entries: [skill.description || '', `Source: claude-plugins.dev`, skill.sourceUrl],
      missingSkillMd: false
    }));
  }

  private fetchUrlText(url: string, redirectCount = 0): Promise<string> {
    if (redirectCount > 5) {
      return Promise.reject(new Error('Trop de redirections'));
    }
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'GET',
        headers: { 'User-Agent': 'vscode-skills-hub-extension' }
      }, (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).toString();
          resolve(this.fetchUrlText(redirectUrl, redirectCount + 1));
          return;
        }

        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (status >= 400) {
            reject(new Error(`HTTP ${status}`));
            return;
          }
          resolve(body);
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  private formatGithubError(error: unknown): string {
    if (error instanceof Error) {
      return `GitHub: ${error.message}`;
    }
    return 'Impossible de charger le repo GitHub';
  }

  private async findGithubSkillsFromTree(owner: string, repo: string, repoPath: string, ref: string) {
    const tree = await this.fetchGithubTree(owner, repo, ref);
    const prefix = repoPath ? `${repoPath.replace(/^\/+|\/+$/g, '')}/` : '';
    const skillDirs = new Set<string>();

    for (const entry of tree) {
      if (entry.type !== 'blob') {
        continue;
      }
      if (!entry.path.startsWith(prefix)) {
        continue;
      }
      if (entry.path === `${prefix}SKILL.md` || entry.path.endsWith('/SKILL.md')) {
        const dir = path.posix.dirname(entry.path);
        skillDirs.add(dir);
      }
    }

    if (!skillDirs.size) {
      return [];
    }

    return Array.from(skillDirs)
      .sort((a, b) => a.localeCompare(b))
      .map((dirPath) => {
        const name = path.posix.basename(dirPath);
        const relative = repoPath
          ? (dirPath.startsWith(repoPath) ? dirPath.slice(repoPath.length).replace(/^\/+/, '') : dirPath)
          : dirPath;
        return {
          name,
          path: relative,
          entries: ['SKILL.md'],
          missingSkillMd: false
        };
      });
  }

  private fetchGithubTree(owner: string, repo: string, ref: string): Promise<GithubTreeEntry[]> {
    const treeRef = ref || 'HEAD';
    const refSegment = encodeURIComponent(treeRef);
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: `/repos/${owner}/${repo}/git/trees/${refSegment}?recursive=1`,
      method: 'GET',
      headers: {
        'User-Agent': 'vscode-skills-hub-extension',
        Accept: 'application/vnd.github.v3+json'
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body) as { tree?: GithubTreeEntry[]; message?: string };
            if (res.statusCode && res.statusCode >= 400) {
              const message = json.message ? `HTTP ${res.statusCode} - ${json.message}` : `HTTP ${res.statusCode}`;
              reject(new Error(message));
              return;
            }
            resolve(Array.isArray(json.tree) ? json.tree : []);
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  private async findGithubSkills(owner: string, repo: string, repoPath: string, ref: string) {
    const entries = await this.fetchGithubContents(owner, repo, repoPath, ref);
    if (!Array.isArray(entries)) {
      return [];
    }

    const hasSkillMd = entries.some((item) => item.type === 'file' && item.name === 'SKILL.md');
    if (hasSkillMd) {
      return [await this.buildGithubSkillCard(owner, repo, repoPath, ref)];
    }

    const skills: { name: string; path: string; entries: string[]; missingSkillMd: boolean }[] = [];
    for (const entry of entries.filter((item) => item.type === 'dir')) {
      const childPath = repoPath ? `${repoPath}/${entry.name}` : entry.name;
      const childSkills = await this.findGithubSkills(owner, repo, childPath, ref);
      skills.push(...childSkills);
    }
    return skills;
  }

  private async buildGithubSkillCard(owner: string, repo: string, repoPath: string, ref: string) {
    const entries = await this.fetchGithubContents(owner, repo, repoPath, ref);
    const list: string[] = [];
    const required = 'SKILL.md';
    if (!Array.isArray(entries)) {
      return { name: repoPath ? path.basename(repoPath) : repo, path: repoPath, entries: ['Erreur de lecture'], missingSkillMd: true };
    }

    const skillMd = entries.find((item) => item.type === 'file' && item.name === required);
    list.push(skillMd ? required : '⚠️ SKILL.md manquant');

    const optionalDirs = ['scripts', 'references', 'assets'];
    for (const dir of optionalDirs) {
      const dirEntry = entries.find((item) => item.type === 'dir' && item.name === dir);
      if (dirEntry) {
        list.push(`${dir}/`);
        const childEntries = await this.fetchGithubContents(owner, repo, repoPath ? `${repoPath}/${dir}` : dir, ref);
        if (Array.isArray(childEntries)) {
          childEntries.sort((a, b) => a.name.localeCompare(b.name));
          for (const child of childEntries) {
            list.push(`  └── ${child.name}${child.type === 'dir' ? '/' : ''}`);
          }
        }
      }
    }

    const topLevelExtras = entries
      .filter((item) => item.name !== required && !optionalDirs.includes(item.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const extra of topLevelExtras) {
      list.push(extra.type === 'dir' ? `${extra.name}/` : extra.name);
    }

    return {
      name: repoPath ? path.basename(repoPath) : repo,
      path: repoPath,
      entries: list,
      missingSkillMd: !skillMd
    };
  }

  private parseGithubRepo(repo: string): { owner: string; name: string; path: string; ref: string } | undefined {
    const normalized = repo.replace(/https?:\/\//, '').replace(/github\.com\//, '');
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const owner = parts[0];
      const name = parts[1];
      if (parts[2] === 'tree' || parts[2] === 'blob') {
        if (parts.length < 5) {
          return undefined;
        }
        const ref = parts[3];
        const repoPath = parts.slice(4).join('/');
        return { owner, name, path: repoPath, ref };
      }
      const repoPath = parts.length > 2 ? parts.slice(2).join('/') : '';
      return { owner, name, path: repoPath, ref: '' };
    }
    return undefined;
  }

  private fetchGithubContents(owner: string, repo: string, repoPath: string, ref = ''): Promise<any[]> {
    const pathSegment = repoPath
      ? '/' + repoPath.split('/').map((segment) => encodeURIComponent(segment)).join('/')
      : '';
    const refSegment = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: `/repos/${owner}/${repo}/contents${pathSegment}${refSegment}`,
      method: 'GET',
      headers: {
        'User-Agent': 'vscode-skills-hub-extension',
        Accept: 'application/vnd.github.v3+json'
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body) as { message?: string } | any[];
            if (res.statusCode && res.statusCode >= 400) {
              if (Array.isArray(json)) {
                reject(new Error(`HTTP ${res.statusCode}`));
                return;
              }
              const message = json.message ? `HTTP ${res.statusCode} - ${json.message}` : `HTTP ${res.statusCode}`;
              reject(new Error(message));
              return;
            }
            if (Array.isArray(json)) {
              resolve(json);
            } else {
              resolve([]);
            }
          } catch (err) {
            reject(err);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview.js'));
    const agentIconMap = {
      copilot: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'copilot.svg')).toString(),
      'kilo-code': webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'kilo-code.svg')).toString(),
      kade: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'kade.svg')).toString(),
      claude: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'claude.svg')).toString(),
      gemini: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'gemini.svg')).toString(),
      'roo-code': webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'roo-code.svg')).toString(),
      'cool-cline': webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'cool-cline.svg')).toString(),
      cline: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'cline.svg')).toString(),
      chatgpt: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'chatgpt.svg')).toString(),
      default: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'default.svg')).toString()
    };
    return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src https: data: ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Skills Hub</title>
  <style>
    body { margin: 0; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
    .tab-toggle { display: none; }
    .tabs { display: flex; border-bottom: 1px solid var(--vscode-editorWidget-border); }
    .tab { flex: 1; padding: 10px; text-align: center; cursor: pointer; }
    .pane { display: none; padding: 12px; }
    #tab-marketplace:checked ~ .tabs label[for="tab-marketplace"],
    #tab-installed:checked ~ .tabs label[for="tab-installed"],
    #tab-settings:checked ~ .tabs label[for="tab-settings"] {
      border-bottom: 2px solid var(--vscode-editorWidget-focusBorder);
      font-weight: bold;
    }
    #tab-marketplace:checked ~ #pane-marketplace,
    #tab-installed:checked ~ #pane-installed,
    #tab-settings:checked ~ #pane-settings {
      display: block;
    }
    .section { margin-bottom: 18px; }
    .section label { display: block; margin-bottom: 6px; font-weight: 600; }
    input[type=text], select { width: 100%; padding: 8px; box-sizing: border-box; margin-bottom: 8px; border: 1px solid var(--vscode-input-border); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
    button { margin-right: 8px; margin-bottom: 8px; padding: 8px 12px; border: none; border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
    button:hover { opacity: 0.95; }
    .list-box { border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; padding: 10px; background: var(--vscode-panel-background); }
    .list-item { margin-bottom: 4px; }
    .folder-title { font-weight: 700; margin-top: 14px; }
    .skill-card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 8px; padding: 12px; margin-bottom: 12px; background: var(--vscode-panel-background); }
    .skill-card-title { font-weight: 700; margin-bottom: 6px; }
    .skill-card-subtitle { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 10px; }
    .agent-icons { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    .agent-icon { display: flex; flex-direction: column; align-items: center; width: 48px; font-size: 0.7em; color: var(--vscode-descriptionForeground); }
    .agent-icon img { width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--vscode-editorWidget-border); background: var(--vscode-editor-background); }
    .agent-icon.installed img { border-color: #6abf69; filter: drop-shadow(0 0 2px rgba(106,191,105,0.9)); }
    .install-button { padding: 6px 10px; border-radius: 4px; border: none; cursor: pointer; font-weight: 600; }
    .install-button.installed { background: #6abf69; color: white; }
    .install-button.available { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .skill-tree { font-family: var(--vscode-editor-font-family); white-space: pre; margin: 0; color: var(--vscode-foreground); }
    .small-text { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  </style>
</head>
<body>
  <input class="tab-toggle" type="radio" name="tabset" id="tab-marketplace" checked />
  <input class="tab-toggle" type="radio" name="tabset" id="tab-installed" />
  <input class="tab-toggle" type="radio" name="tabset" id="tab-settings" />

  <div class="tabs">
    <label class="tab" for="tab-marketplace">Marketplace</label>
    <label class="tab" for="tab-installed">Installed</label>
    <label class="tab" for="tab-settings">Settings</label>
  </div>

  <div class="pane" id="pane-marketplace">
    <div class="section">
      <label>Source unique des skills : <a href="https://claude-plugins.dev/skills" target="_blank">claude-plugins.dev/skills</a></label>
      <div id="marketplace-repos" class="list-box" style="display:none"></div>
    </div>
    <div class="section">
      <label>Compétences détectées dans le marketplace</label>
      <div id="marketplace-skills" class="list-box"></div>
    </div>
  </div>

  <div class="pane" id="pane-installed">
    <div class="section">
      <label>Filtrer par dossier de skills</label>
      <select id="installed-filter"></select>
    </div>
    <div class="section">
      <label>Skills installés</label>
      <div id="installed-skills" class="list-box"></div>
    </div>
  </div>

  <div class="pane" id="pane-settings">
    <div class="section">
      <label>Chemins des dossiers /skills</label>
      <div id="skill-paths" class="list-box"></div>
      <input type="text" id="new-skill-path" placeholder="Ajouter un chemin de dossier..." />
      <button id="add-skill-path">Ajouter chemin</button>
    </div>
    <div class="section">
      <label>Source unique des skills : <a href="https://claude-plugins.dev/skills" target="_blank">claude-plugins.dev/skills</a></label>
      <div id="repo-list" class="list-box" style="display:none"></div>
      <input type="text" id="new-repo" style="display:none" />
      <button id="add-repo" style="display:none">Ajouter repo</button>
    </div>
    <div class="section small-text">
      <p id="config-location-text">Chargement du chemin de configuration...</p>
      <p id="status-text">Initialisation...</p>
    </div>
  </div>

  <script>
    const agentIconMap = ${JSON.stringify(agentIconMap)};
  </script>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
