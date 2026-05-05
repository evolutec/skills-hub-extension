import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as https from 'https';

interface AgentConfig {
  path: string;
  icon?: string;
}

type SupportedLanguage = 'en' | 'es' | 'zh' | 'fr' | 'ar';

interface SkillsConfig {
  skillPaths: string[];
  agents: AgentConfig[];
  language: SupportedLanguage;
}

interface RepoConfig {
  repos: string[];
}

interface GithubTreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
}

interface ClaudePluginsApiResponse {
  total?: number;
  limit?: number;
  offset?: number;
  skills?: any[];
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
  private static readonly CLAUDE_PLUGINS_PAGE_SIZE = 200;
  private static readonly CLAUDE_PLUGINS_CACHE_TTL_MS = 5 * 60 * 1000;
  private static readonly DEFAULT_LANGUAGE: SupportedLanguage = 'en';
  private static readonly SUPPORTED_LANGUAGES: SupportedLanguage[] = ['en', 'es', 'zh', 'fr', 'ar'];
  private claudePluginsCache?: {
    loadedAt: number;
    skills: { name: string; path: string; entries: string[]; missingSkillMd: boolean }[];
  };
  private marketplaceSkills: { name: string; path: string; entries: string[]; missingSkillMd: boolean; sourceUrl?: string }[] = [];

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
        case 'loadMarketplacePage':
          return webviewView.webview.postMessage({
            command: 'marketplaceSkills',
            data: await this.loadMarketplaceSkills(message.data.repos, message.data.page, message.data.limit)
          });
        case 'toggleMarketplaceSkill':
          try {
            const config = await this.readConfig();
            const skillName = typeof message.data.skillName === 'string' ? message.data.skillName : '';
            const agentPath = typeof message.data.agentPath === 'string' ? message.data.agentPath : '';
            const install = Boolean(message.data.install);
            if (skillName && agentPath) {
              if (install) {
                const skill = this.marketplaceSkills.find(s => s.name === skillName);
                const sourceUrl = skill?.sourceUrl || (skill && skill.entries[1] === 'Source: claude-plugins.dev' ? skill.entries[2] : undefined);
                await this.installSkillToAgent(agentPath, skillName, sourceUrl);
              } else {
                await this.uninstallSkillFromAgent(agentPath, skillName);
              }
            }
          } catch {
            // ignore toggle errors silently
          }
          webviewView.webview.postMessage({
            command: 'installedSkills',
            data: await this.loadInstalledSkills((await this.readConfig()).skillPaths)
          });
          return webviewView.webview.postMessage({
            command: 'marketplaceSkills',
            data: await this.loadMarketplaceSkills(message.data.repos, message.data.page, message.data.limit)
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
      fs.writeFileSync(configPath.fsPath, JSON.stringify({ skillPaths: [], agents: [], language: SkillsHubViewProvider.DEFAULT_LANGUAGE }, null, 2), 'utf8');
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
      agents: config.agents,
      language: config.language,
      customAgentIcons: this.buildCustomAgentIcons(config.agents),
      repos: repoConfig.repos,
      configFolderPath: this.getConfigFolder().fsPath,
      installedSkills,
      marketplaceSkills
    };
  }

  private normalizeLanguage(input: unknown): SupportedLanguage {
    if (typeof input !== 'string') {
      return SkillsHubViewProvider.DEFAULT_LANGUAGE;
    }
    const normalized = input.trim().toLowerCase() as SupportedLanguage;
    return SkillsHubViewProvider.SUPPORTED_LANGUAGES.includes(normalized)
      ? normalized
      : SkillsHubViewProvider.DEFAULT_LANGUAGE;
  }

  private normalizeAgentPath(input: string): string {
    const normalized = input.replace(/\\/g, '/').trim().replace(/\/+$/, '');
    if (!normalized) {
      return '';
    }
    if (normalized.toLowerCase().endsWith('/skills')) {
      return normalized;
    }
    return `${normalized}/skills`;
  }

  private normalizeAgents(rawAgents: unknown, legacySkillPaths: string[]): AgentConfig[] {
    const candidates: AgentConfig[] = [];
    if (Array.isArray(rawAgents)) {
      for (const item of rawAgents) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        const pathValue = (item as { path?: unknown }).path;
        if (typeof pathValue !== 'string') {
          continue;
        }
        const normalizedPath = this.normalizeAgentPath(pathValue);
        if (!normalizedPath) {
          continue;
        }
        const iconValue = (item as { icon?: unknown }).icon;
        const icon = typeof iconValue === 'string' && iconValue.trim() ? iconValue.trim() : undefined;
        candidates.push({ path: normalizedPath, icon });
      }
    }

    if (!candidates.length && Array.isArray(legacySkillPaths)) {
      for (const skillPath of legacySkillPaths) {
        if (typeof skillPath !== 'string') {
          continue;
        }
        const normalizedPath = this.normalizeAgentPath(skillPath);
        if (!normalizedPath) {
          continue;
        }
        candidates.push({ path: normalizedPath });
      }
    }

    const deduped: AgentConfig[] = [];
    const seenPaths = new Set<string>();
    for (const candidate of candidates) {
      const key = candidate.path.toLowerCase();
      if (seenPaths.has(key)) {
        continue;
      }
      seenPaths.add(key);
      deduped.push(candidate.icon ? { path: candidate.path, icon: candidate.icon } : { path: candidate.path });
    }
    return deduped;
  }

  private normalizeAgentKeyFromPath(folderPath: string): string {
    const normalized = folderPath.replace(/\\/g, '/').replace(/\/+$|^\/+/, '');
    const segments = normalized.split('/').filter(Boolean);
    let key = segments[segments.length - 1] || '';
    if (key.toLowerCase() === 'skills' && segments.length > 1) {
      key = segments[segments.length - 2];
    }
    return key.replace(/^\.+/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  private buildCustomAgentIcons(agents: AgentConfig[]): Record<string, string> {
    const iconsByAgent: Record<string, string> = {};
    for (const agent of agents) {
      if (!agent.icon || !agent.icon.trim()) {
        continue;
      }
      const key = this.normalizeAgentKeyFromPath(agent.path);
      if (!key) {
        continue;
      }
      iconsByAgent[key] = agent.icon.trim();
    }
    return iconsByAgent;
  }

  private async readConfig(): Promise<SkillsConfig> {
    const file = vscode.Uri.file(this.getConfigFile().fsPath);
    try {
      const raw = fs.readFileSync(file.fsPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<SkillsConfig>;
      const legacySkillPaths = Array.isArray(parsed.skillPaths) ? parsed.skillPaths : [];
      const agents = this.normalizeAgents(parsed.agents, legacySkillPaths);
      const language = this.normalizeLanguage(parsed.language);
      return {
        agents,
        skillPaths: agents.map((agent) => agent.path),
        language
      };
    } catch {
      return { skillPaths: [], agents: [], language: SkillsHubViewProvider.DEFAULT_LANGUAGE };
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

  private async installSkillToAgent(agentPath: string, skillName: string, sourceUrl?: string) {
    try {
      const normalizedAgentPath = this.normalizeAgentPath(agentPath);
      const skillDir = path.join(normalizedAgentPath, skillName);
      if (fs.existsSync(skillDir)) {
        return;
      }
      fs.mkdirSync(skillDir, { recursive: true });
      const skillMdPath = path.join(skillDir, 'SKILL.md');

      let skillMdContent = `# ${skillName}\n\nSkill installée via Skills Hub.`;

      if (sourceUrl) {
        try {
          const parsed = this.parseGithubRepo(sourceUrl);
          if (parsed) {
            // Try to fetch SKILL.md from the repo
            const content = await this.fetchGithubFileContent(parsed.owner, parsed.name, parsed.path ? `${parsed.path}/SKILL.md` : 'SKILL.md', parsed.ref);
            if (content) {
              skillMdContent = content;
            }
          }
        } catch {
          // Fall back to default content
        }
      }

      fs.writeFileSync(skillMdPath, skillMdContent, 'utf8');
    } catch {
      // ignore errors
    }
  }

  private async uninstallSkillFromAgent(agentPath: string, skillName: string) {
    try {
      const normalizedAgentPath = this.normalizeAgentPath(agentPath);
      const skillDir = path.join(normalizedAgentPath, skillName);
      if (!fs.existsSync(skillDir)) {
        return;
      }
      fs.rmSync(skillDir, { recursive: true, force: true });
    } catch {
      // ignore errors
    }
  }

  private async writeConfig(data: Partial<SkillsConfig>) {
    await this.ensureConfigFiles();
    const file = vscode.Uri.file(this.getConfigFile().fsPath);
    const legacySkillPaths = Array.isArray(data.skillPaths) ? data.skillPaths : [];
    const agents = this.normalizeAgents(data.agents, legacySkillPaths);
    const language = this.normalizeLanguage(data.language);
    const payload: SkillsConfig = {
      skillPaths: agents.map((agent) => agent.path),
      agents,
      language
    };
    fs.writeFileSync(file.fsPath, JSON.stringify(payload, null, 2), 'utf8');
  }

  private async writeRepoConfig(data: RepoConfig) {
    await this.ensureConfigFiles();
    const file = vscode.Uri.file(this.getRepoConfigFile().fsPath);
    fs.writeFileSync(file.fsPath, JSON.stringify(data, null, 2), 'utf8');
  }

  private isDirectoryEntry(parentPath: string, entry: fs.Dirent): boolean {
    if (entry.isDirectory()) {
      return true;
    }
    if (!entry.isSymbolicLink()) {
      return false;
    }

    try {
      const resolved = path.join(parentPath, entry.name);
      return fs.statSync(resolved).isDirectory();
    } catch {
      return false;
    }
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
          .filter((entry) => this.isDirectoryEntry(fullPath, entry));

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

  private async loadMarketplaceSkills(repos: string[], page = 0, limit = SkillsHubViewProvider.CLAUDE_PLUGINS_PAGE_SIZE) {
    const result: { repo: string; skills: { name: string; path: string; entries: string[]; missingSkillMd: boolean; sourceUrl?: string }[]; total: number; page: number; limit: number }[] = [];
    for (const repo of repos) {
      try {
        if (this.isClaudePluginsSource(repo)) {
          const response = await this.loadClaudePluginsSkills(repo, page, limit);
          if (!response.skills.length) {
            result.push({ repo, skills: [{ name: '', path: '', entries: ['Aucun skill détecté dans cette source'], missingSkillMd: true }], total: response.total, page: response.page, limit: response.limit });
          } else {
            result.push({ repo, skills: response.skills, total: response.total, page: response.page, limit: response.limit });
          }
          continue;
        }

        const parsed = this.parseGithubRepo(repo);
        if (!parsed) {
          result.push({ repo, skills: [{ name: '', path: '', entries: ['Format de repo invalide'], missingSkillMd: true }], total: 0, page: 0, limit: 0 });
          continue;
        }

        let skills = await this.findGithubSkillsFromTree(parsed.owner, parsed.name, parsed.path, parsed.ref);
        if (!skills.length) {
          skills = await this.findGithubSkills(parsed.owner, parsed.name, parsed.path, parsed.ref);
        }
        if (!skills.length) {
          result.push({ repo, skills: [{ name: '', path: '', entries: ['Aucun skill détecté dans le repo'], missingSkillMd: true }], total: 0, page: 0, limit: 0 });
        } else {
          // Add sourceUrl to skills
          skills = skills.map(s => ({ ...s, sourceUrl: repo }));
          result.push({ repo, skills, total: skills.length, page: 0, limit: skills.length });
        }
      } catch (error) {
        result.push({
          repo,
          skills: [{ name: '', path: '', entries: [this.formatGithubError(error)], missingSkillMd: true }],
          total: 0,
          page: 0,
          limit: 0
        });
      }
    }
    this.marketplaceSkills = result.flatMap(r => r.skills);
    return result;
  }

  private isClaudePluginsSource(source: string): boolean {
    return source.includes('claude-plugins.dev');
  }

  private async loadClaudePluginsSkills(source: string, page: number, limit: number) {
    const offset = Math.max(0, page) * Math.max(1, limit);
    const apiUrl = `https://claude-plugins.dev/api/skills?limit=${Math.max(1, limit)}&offset=${offset}`;
    const raw = await this.fetchUrlText(apiUrl);
    const data = JSON.parse(raw) as ClaudePluginsApiResponse;
    const pageSkills = Array.isArray(data.skills) ? data.skills : [];
    const total = typeof data.total === 'number' && data.total >= 0 ? data.total : pageSkills.length;

    return {
      skills: pageSkills.map((skill: any) => ({
        name: skill.name,
        path: skill.namespace,
        description: typeof skill.description === 'string' ? skill.description : '',
        sourceUrl: skill.sourceUrl,
        entries: [
          skill.description || '',
          `Source: claude-plugins.dev`,
          skill.sourceUrl,
          (skill.metadata && skill.metadata.iconUrl) ? skill.metadata.iconUrl : ''
        ],
        missingSkillMd: false
      })),
      total,
      page: Math.max(0, page),
      limit: Math.max(1, limit)
    };
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
            const json = JSON.parse(body) as { message?: string } | any[] | any;
            if (res.statusCode && res.statusCode >= 400) {
              const message = json.message ? `HTTP ${res.statusCode} - ${json.message}` : `HTTP ${res.statusCode}`;
              reject(new Error(message));
              return;
            }
            if (Array.isArray(json)) {
              resolve(json);
            } else if (json && typeof json === 'object') {
              // It's a file object
              resolve([json]);
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

  private async fetchGithubFileContent(owner: string, repo: string, filePath: string, ref = ''): Promise<string | null> {
    const pathSegment = '/' + filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
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
            const json = JSON.parse(body) as { message?: string; content?: string; encoding?: string };
            if (res.statusCode && res.statusCode >= 400) {
              const message = json.message ? `HTTP ${res.statusCode} - ${json.message}` : `HTTP ${res.statusCode}`;
              reject(new Error(message));
              return;
            }
            if (json.content && json.encoding === 'base64') {
              resolve(Buffer.from(json.content, 'base64').toString('utf8'));
            } else {
              resolve(null);
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

  private escapeHtmlAttribute(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview.js'));

    const agentIconMap = {
      copilot: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'copilot.svg')).toString(),
      'kilo-code': webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'kilo-code.svg')).toString(),
      kilo: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'kilo-code.svg')).toString(),
      kilocode: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'kilo-code.svg')).toString(),
      kade: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'kade.svg')).toString(),
      claude: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'claude.svg')).toString(),
      gemini: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'gemini.svg')).toString(),
      'roo-code': webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'roo.svg')).toString(),
      roo: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'roo.svg')).toString(),
      'cool-cline': webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'cool-cline.svg')).toString(),
      cline: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'cline.svg')).toString(),
      chatgpt: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'chatgpt.svg')).toString(),
      default: webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'resources', 'default.svg')).toString()
    };
    const serializedAgentIconMap = this.escapeHtmlAttribute(JSON.stringify(agentIconMap));



    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource}; img-src https: data: ${webview.cspSource};" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Skills Hub</title>
  <style>
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    .tab-toggle { display: none; }
    .tabs {
      display: flex;
      border-bottom: 1px solid var(--vscode-editorWidget-border);
      gap: 4px;
    }
    .tab {
      flex: 1;
      padding: 12px 0;
      text-align: center;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: border-color 0.2s ease, color 0.2s ease;
    }
    .tab:hover {
      color: var(--vscode-button-secondaryForeground);
    }
    #tab-marketplace:checked ~ .tabs label[for="tab-marketplace"],
    #tab-agents:checked ~ .tabs label[for="tab-agents"],
    #tab-settings:checked ~ .tabs label[for="tab-settings"] {
      border-bottom-color: var(--vscode-focusBorder);
      color: var(--vscode-focusBorder);
      font-weight: 700;
    }
    #tab-marketplace:checked ~ #pane-marketplace,
    #tab-agents:checked ~ #pane-agents,
    #tab-settings:checked ~ #pane-settings {
      display: block;
    }
    .pane { display: none; padding: 16px; }
    .section { margin-bottom: 20px; }
    .section-title {
      display: block;
      margin: 0 auto 16px;
      width: fit-content;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--vscode-foreground);
    }
    input[type=text], select {
      width: 100%;
      padding: 10px 12px;
      box-sizing: border-box;
      margin-bottom: 8px;
      border: 1px solid var(--vscode-input-border);
      border-radius: 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
    }
    button {
      margin-right: 8px;
      margin-bottom: 8px;
      padding: 10px 14px;
      border: 1px solid transparent;
      border-radius: 10px;
      background: var(--vscode-button-surface);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
    }
    button:hover {
      transform: translateY(-1px);
      background: var(--vscode-button-hoverBackground);
      border-color: var(--vscode-button-border);
    }
    .list-box {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 14px;
      padding: 16px;
      background: var(--vscode-editor-background);
      box-shadow: 0 10px 20px rgba(0, 0, 0, 0.04);
    }
    .list-item { margin-bottom: 8px; }
    .folder-title {
      font-weight: 700;
      margin-top: 20px;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 0.95rem;
    }
    .skill-card {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 16px;
      background: var(--vscode-editor-background);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.04);
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }
    .skill-card:hover {
      border-color: var(--vscode-focusBorder);
      box-shadow: 0 10px 26px rgba(0, 0, 0, 0.06);
    }
    .skill-card-title { font-weight: 700; margin-bottom: 10px; }
    .skill-card-subtitle { color: var(--vscode-descriptionForeground); font-size: 0.92em; margin-bottom: 12px; }
    .agent-icons { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px; }
    .agent-icon { display: flex; flex-direction: column; justify-content: center; align-items: center; width: 52px; font-size: 0.75em; color: var(--vscode-descriptionForeground); cursor: pointer; }
    .agent-icon img { width: 34px; height: 34px; border-radius: 10px; border: 1px solid white; background: var(--vscode-editor-background); }
    .agent-icon.installed img { border-color: #4eb85e; box-shadow: 0 0 0 2px rgba(78, 184, 94, 0.18); }
    .install-button { display: none; }
    .skill-tree { font-family: var(--vscode-editor-font-family); white-space: pre; margin: 0; color: var(--vscode-foreground); }
    .small-text { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .agent-add-controls {
      margin-bottom: 12px;
      display: flex;
      justify-content: center;
    }
    .agent-add-controls #add-agent {
      margin: 0;
      min-width: 180px;
      font-weight: 700;
    }
    .agent-form, .marketplace-filter-wrap {
      border: 1px solid var(--vscode-editorWidget-border);
      border-radius: 14px;
      padding: 16px;
      background: var(--vscode-editor-background);
      box-shadow: 0 8px 20px rgba(0,0,0,0.04);
    }
    .agent-form-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
    .agent-form-title { font-weight: 700; }
    .agent-form-close { background: transparent; border: 1px solid var(--vscode-editorWidget-border); color: var(--vscode-foreground); padding: 4px 10px; border-radius: 10px; font-size: 0.95rem; }
    .agent-form label { display: block; margin-top: 10px; margin-bottom: 6px; font-weight: 600; }
    .drop-zone { display: flex; align-items: center; justify-content: center; min-height: 68px; padding: 10px; margin-bottom: 8px; border: 1px dashed var(--vscode-input-border); border-radius: 12px; color: var(--vscode-descriptionForeground); cursor: pointer; text-align: center; }
    .drop-zone.dragover { border-color: var(--vscode-focusBorder); }
    .drop-zone-actions { margin-bottom: 8px; }
    .agent-form-actions { margin-top: 8px; display: flex; gap: 10px; flex-wrap: wrap; }
    .agent-icon-preview-wrap { width: 44px; height: 44px; border-radius: 12px; border: 1px solid var(--vscode-editorWidget-border); background: var(--vscode-editor-background); display: flex; align-items: center; justify-content: center; overflow: hidden; margin-bottom: 8px; }
    .agent-icon-preview-wrap img { width: 32px; height: 32px; display: none; }
    .marketplace-filter-wrap { margin-top: 8px; }
    .marketplace-filter-wrap input { margin-bottom: 0; }
    .marketplace-pagination { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 14px; margin-bottom: 14px; }
    .settings-field {
      max-width: 360px;
      margin: 0 auto;
    }
    .settings-field label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .status-text {
      min-height: 1.2em;
      padding: 0 16px 12px;
    }
  </style>
</head>
<body>
  <input class="tab-toggle" type="radio" name="tabset" id="tab-marketplace" checked />
  <input class="tab-toggle" type="radio" name="tabset" id="tab-agents" />
  <input class="tab-toggle" type="radio" name="tabset" id="tab-settings" />

  <div class="tabs">
    <label class="tab" id="tab-label-marketplace" for="tab-marketplace">Marketplace</label>
    <label class="tab" id="tab-label-agents" for="tab-agents">Agents</label>
    <label class="tab" id="tab-label-settings" for="tab-settings">Settings</label>
  </div>

  <div class="pane" id="pane-marketplace">
    <div class="section">
      <div class="marketplace-filter-wrap">
        <input type="text" id="marketplace-filter" placeholder="Filter skills (name, namespace, description)" />
      </div>
      <div class="marketplace-pagination">
        <button id="marketplace-prev" type="button">Previous</button>
        <span id="marketplace-page-label" class="small-text"></span>
        <button id="marketplace-next" type="button">Next</button>
      </div>
      <div id="marketplace-count" class="small-text"></div>
      <div id="marketplace-repos" class="list-box" style="display:none"></div>
    </div>
    <div class="section">
      <div id="marketplace-skills" class="list-box"></div>
    </div>
  </div>

  <div class="pane" id="pane-agents">
    <div class="section">
      <div class="agent-add-controls">
        <button id="add-agent">Add Agent</button>
      </div>
      <div id="agent-form" class="agent-form" hidden>
        <div class="agent-form-header">
          <div id="agent-form-title" class="agent-form-title">Add Agent</div>
          <button id="close-agent-form" class="agent-form-close" type="button" aria-label="Close agent form">✕</button>
        </div>
        <label id="label-new-agent-path" for="new-agent-path">Agent path</label>
        <input type="text" id="new-agent-path" placeholder="C:/Users/.../.roo/skills" />
        <label id="label-new-agent-icon-select" for="new-agent-icon-select">Preset icon</label>
        <select id="new-agent-icon-select"></select>
        <label id="label-new-agent-icon-file" for="new-agent-icon-file">Custom icon (drag and drop or file picker)</label>
        <label id="agent-icon-dropzone" class="drop-zone" for="new-agent-icon-file">Drop an image file here, or click to choose.</label>
        <input type="file" id="new-agent-icon-file" accept="image/*" hidden />
        <div class="drop-zone-actions">
          <button id="clear-agent-icon" type="button">Remove custom icon</button>
        </div>
        <div class="agent-icon-preview-wrap">
          <img id="new-agent-icon-preview" alt="Agent icon preview" />
        </div>
        <div class="agent-form-actions">
          <button id="save-agent" type="button">Save</button>
          <button id="cancel-agent" type="button">Cancel</button>
        </div>
      </div>
      <div id="agent-cards" class="list-box"></div>
    </div>
  </div>

  <div class="pane" id="pane-settings">
    <div class="section">
      <label class="section-title" id="settings-section-title">Settings</label>
      <div class="list-box">
        <div class="settings-field">
          <label id="settings-language-label" for="settings-language-select">Language</label>
          <select id="settings-language-select">
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="zh">中文</option>
            <option value="fr">Français</option>
            <option value="ar">العربية</option>
          </select>
          <div id="settings-language-hint" class="small-text">Language is saved automatically.</div>
        </div>
      </div>
    </div>
  </div>

  <div id="status-text" class="small-text status-text" aria-live="polite"></div>
  <div id="agent-icon-map" data-json="${serializedAgentIconMap}" hidden></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
  }
}
