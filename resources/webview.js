(function () {
  let vscode;
  try {
    vscode = acquireVsCodeApi();
  } catch {
    vscode = undefined;
  }

  let state = { skillPaths: [], agents: [], customAgentIcons: {}, repos: [], installedSkills: [], marketplaceSkills: [], marketplacePage: 0, marketplaceLimit: 50, marketplaceTotal: 0, configFolderPath: '' };
  let pendingCustomIcon = '';
  let editingAgentKey = '';

  function byId(id) {
    return document.getElementById(id);
  }

  function readAgentIconMap() {
    const holder = byId('agent-icon-map');
    if (!holder) {
      return {};
    }
    const raw = holder.getAttribute('data-json');
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  const agentIconMap = readAgentIconMap();

  function setStatus(message, isError) {
    const status = byId('status-text');
    if (!status) {
      return;
    }
    status.textContent = message || '';
    status.style.color = isError ? '#f14c4c' : '';
  }

  function getAgentPathByKey(agentKey) {
    if (!Array.isArray(state.agents)) {
      return '';
    }
    const agent = state.agents.find((entry) => normalizeAgentKey(entry.path || '') === agentKey);
    return agent && typeof agent.path === 'string' ? agent.path : '';
  }

  function loadMarketplacePage(page) {
    if (!vscode) {
      setStatus('Impossible de charger le marketplace: API VS Code introuvable.', true);
      return;
    }
    const repos = Array.isArray(state.repos) ? state.repos : [];
    const limit = state.marketplaceLimit || 50;
    vscode.postMessage({ command: 'loadMarketplacePage', data: { repos, page, limit } });
    setStatus('', false);
  }

  function setAgentFormTitle(text) {
    const title = byId('agent-form-title');
    if (!title) {
      return;
    }
    title.textContent = text;
  }

  function closeAgentForm() {
    const form = byId('agent-form');
    if (!form) {
      return;
    }
    form.hidden = true;
    editingAgentKey = '';
    setAgentFormTitle('Ajouter agent');
    resetAgentForm();
  }

  function openAgentFormForCreate() {
    const form = byId('agent-form');
    if (!form) {
      return;
    }
    editingAgentKey = '';
    setAgentFormTitle('Ajouter agent');
    populatePresetIconSelect();
    resetAgentForm();
    form.hidden = false;
    const pathInput = byId('new-agent-path');
    if (pathInput) {
      pathInput.focus();
    }
  }

  function findPresetKeyByIcon(iconValue) {
    const normalized = String(iconValue || '').trim();
    if (!normalized) {
      return '';
    }
    const lower = normalized.toLowerCase();
    const mapEntries = Object.entries(agentIconMap || {});

    for (const [key] of mapEntries) {
      if (key.toLowerCase() === lower) {
        return key;
      }
    }

    for (const [key, uri] of mapEntries) {
      if (typeof uri === 'string' && uri === normalized) {
        return key;
      }
    }

    if (lower.includes('/')) {
      const fileName = lower.split('/').pop() || '';
      const stem = fileName.replace(/\.(svg|png|jpe?g|gif|webp)$/i, '');
      for (const [key] of mapEntries) {
        if (key.toLowerCase() === stem) {
          return key;
        }
      }
    }

    return '';
  }

  function openAgentFormForEdit(agent) {
    const form = byId('agent-form');
    const pathInput = byId('new-agent-path');
    const select = byId('new-agent-icon-select');
    if (!form || !pathInput || !select) {
      return;
    }

    const normalizedPath = normalizeAgentPath(agent && agent.path ? agent.path : '');
    if (!normalizedPath) {
      return;
    }

    editingAgentKey = normalizeAgentKey(normalizedPath);
    setAgentFormTitle('Modifier agent');
    populatePresetIconSelect();
    resetAgentForm();

    pathInput.value = normalizedPath;

    const iconValue = agent && typeof agent.icon === 'string' ? agent.icon.trim() : '';
    if (iconValue) {
      const presetKey = findPresetKeyByIcon(iconValue);
      if (presetKey && [...select.options].some((option) => option.value === presetKey)) {
        select.value = presetKey;
      } else {
        pendingCustomIcon = iconValue;
      }
    }

    updateAgentIconPreview();
    form.hidden = false;
    pathInput.focus();
  }

  function sendSaveSkillConfig() {
    if (!vscode) {
      setStatus('Impossible de sauvegarder: API VS Code introuvable.', true);
      return;
    }
    const agents = Array.isArray(state.agents) ? state.agents : [];
    const cleanedAgents = agents
      .map((agent) => {
        if (!agent || typeof agent.path !== 'string') {
          return null;
        }
        const normalizedPath = normalizeAgentPath(agent.path);
        if (!normalizedPath) {
          return null;
        }
        const icon = typeof agent.icon === 'string' && agent.icon.trim() ? agent.icon.trim() : undefined;
        return icon ? { path: normalizedPath, icon } : { path: normalizedPath };
      })
      .filter(Boolean);
    vscode.postMessage({
      command: 'saveSkillConfig',
      data: {
        agents: cleanedAgents,
        skillPaths: cleanedAgents.map((agent) => agent.path)
      }
    });
    setStatus('Sauvegarde des chemins envoyee.', false);
  }

  function sendSaveRepoConfig() {
    if (!vscode) {
      setStatus('Impossible de sauvegarder: API VS Code introuvable.', true);
      return;
    }
    vscode.postMessage({ command: 'saveRepoConfig', data: { repos: state.repos } });
    setStatus('Sauvegarde des repos envoyee.', false);
  }

  function renderConfigPath() {
    // supprimé : plus d'affichage du chemin de config
  }

  function getAgentPathByKey(agentKey) {
    if (!Array.isArray(state.agents)) {
      return '';
    }
    const agent = state.agents.find((entry) => normalizeAgentKey(entry.path || '') === agentKey);
    return agent && typeof agent.path === 'string' ? agent.path : '';
  }

  function normalizeAgentPath(value) {
    const normalized = String(value || '').replace(/\\/g, '/').trim().replace(/\/+$/, '');
    if (!normalized) {
      return '';
    }
    if (normalized.toLowerCase().endsWith('/skills')) {
      return normalized;
    }
    return normalized + '/skills';
  }

  function ensureAgentsStateSynced() {
    if (!Array.isArray(state.agents) || !state.agents.length) {
      const paths = Array.isArray(state.skillPaths) ? state.skillPaths : [];
      state.agents = paths
        .map((pathValue) => normalizeAgentPath(pathValue))
        .filter(Boolean)
        .map((pathValue) => ({ path: pathValue }));
    }
    state.skillPaths = state.agents.map((agent) => agent.path);
  }

  function getPresetIconKeys() {
    const hiddenAliases = new Set(['default', 'roo-code', 'kilo', 'kilocode', 'cool-cline']);
    const uniqueByUri = new Set();
    const options = [];
    Object.keys(agentIconMap || {}).forEach((key) => {
      if (hiddenAliases.has(key)) {
        return;
      }
      const uri = agentIconMap[key];
      if (!uri || uniqueByUri.has(uri)) {
        return;
      }
      uniqueByUri.add(uri);
      options.push(key);
    });
    options.sort((a, b) => a.localeCompare(b));
    return options;
  }

  function getCustomIconByAgentKey(agentKey) {
    const map = state.customAgentIcons || {};
    if (map[agentKey]) {
      return map[agentKey];
    }
    return '';
  }

  function resolveAgentDisplayIcon(agentKey) {
    const customIcon = getCustomIconByAgentKey(agentKey);
    if (customIcon) {
      return resolveIconUrl(customIcon, agentIconMap);
    }
    return resolveIconUrl(agentKey, agentIconMap);
  }

  function resolveIconUrl(icon, agentIconMap) {
    if (!icon) return '';
    const normalizedIcon = String(icon).trim();
    if (normalizedIcon.startsWith('http')) return normalizedIcon;
    if (normalizedIcon.startsWith('data:')) return normalizedIcon;
    if (normalizedIcon.startsWith('vscode-')) return normalizedIcon; // URI absolue déjà
    if (normalizedIcon.startsWith('./')) return normalizedIcon; // Chemin relatif

    const normalizedKey = normalizedIcon.toLowerCase().replace(/\\/g, '/');
    // Si c'est un chemin local, essayer de le résoudre via agentIconMap
    if (agentIconMap && agentIconMap[normalizedKey]) {
      return agentIconMap[normalizedKey];
    }
    // Si c'est un chemin relatif resources/ ou /resources/
    if (normalizedKey.includes('resources/')) {
      const fileName = normalizedKey.split('/').pop().split('?')[0].split('#')[0];
      const key = fileName.replace(/\.(svg|png|jpe?g|gif|webp)$/i, '');
      if (agentIconMap && agentIconMap[key]) {
        return agentIconMap[key];
      }
    }
    return agentIconMap && agentIconMap.default ? agentIconMap.default : '';
  }

  function isImageLikeString(value) {
    if (!value || typeof value !== 'string') {
      return false;
    }
    const trimmed = value.trim().toLowerCase();
    if (trimmed.startsWith('data:image/')) {
      return true;
    }
    return /\.(svg|png|jpe?g|gif|webp)(\?.*)?(#.*)?$/i.test(trimmed);
  }

  function normalizeSkillToken(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) {
      return '';
    }
    const ascii = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return ascii
      .replace(/[\\/_.\s]+/g, '-')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  function getPathLeaf(value) {
    const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
    if (!normalized) {
      return '';
    }
    const segments = normalized.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : '';
  }

  function getUrlLeaf(value) {
    try {
      const parsed = new URL(String(value || '').trim());
      const segments = parsed.pathname.split('/').filter(Boolean);
      return segments.length ? segments[segments.length - 1] : '';
    } catch {
      return '';
    }
  }

  function buildSkillMatchKeys(skill) {
    const keys = new Set();
    const add = (value) => {
      const token = normalizeSkillToken(value);
      if (token) {
        keys.add(token);
      }
    };

    if (!skill || typeof skill !== 'object') {
      return keys;
    }

    if (typeof skill.name === 'string') {
      add(skill.name);
      add(getPathLeaf(skill.name));
    }

    if (typeof skill.path === 'string') {
      add(skill.path);
      add(getPathLeaf(skill.path));
    }

    if (Array.isArray(skill.entries)) {
      skill.entries.forEach((entry) => {
        if (typeof entry !== 'string') {
          return;
        }
        const trimmed = entry.trim();
        if (!trimmed) {
          return;
        }
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          add(getUrlLeaf(trimmed));
        }
      });
    }

    return keys;
  }

  function hasSkillMatch(agentSkillKeys, targetSkillKeys) {
    if (!agentSkillKeys || !targetSkillKeys || !targetSkillKeys.size) {
      return false;
    }
    for (const key of targetSkillKeys) {
      if (agentSkillKeys.has(key)) {
        return true;
      }
    }
    return false;
  }

  function skillMatchesFilter(skill, normalizedFilter) {
    if (!normalizedFilter) {
      return true;
    }
    const fields = [];
    if (skill && typeof skill.name === 'string') {
      fields.push(skill.name);
    }
    if (skill && typeof skill.path === 'string') {
      fields.push(skill.path);
    }
    if (skill && Array.isArray(skill.entries) && typeof skill.entries[0] === 'string') {
      fields.push(skill.entries[0]);
    }
    return fields.some((field) => normalizeSkillToken(field).includes(normalizedFilter));
  }

  function getMarketplaceSkillDescription(skill) {
    if (skill && typeof skill.description === 'string' && skill.description.trim()) {
      return skill.description.trim();
    }

    if (!skill || !Array.isArray(skill.entries)) {
      return '';
    }

    for (const entry of skill.entries) {
      if (typeof entry !== 'string') {
        continue;
      }
      const text = entry.trim();
      if (!text) {
        continue;
      }
      if (text.startsWith('Source:')) {
        continue;
      }
      if (/^https?:\/\//i.test(text)) {
        continue;
      }
      if (text === 'SKILL.md' || text.includes('SKILL.md manquant')) {
        continue;
      }
      return text;
    }

    return '';
  }

  function renderAgentCards() {
    const container = byId('agent-cards');
    if (!container) return;
    container.innerHTML = '';
    ensureAgentsStateSynced();

    state.installedSkills.forEach((group) => {
      const agent = normalizeAgentKey(group.folder);
      if (!agent) return;
      const card = document.createElement('div');
      card.className = 'skill-card';
      card.style.display = 'flex';
      card.style.flexDirection = 'column';
      card.style.gap = '10px';
      card.style.marginBottom = '16px';
      card.style.position = 'relative';

      // Ligne 1 : nom + icône + bouton supprimer
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.justifyContent = 'space-between';
      header.style.gap = '12px';

      const iconDiv = document.createElement('div');
      iconDiv.className = 'agent-icon';
      const img = document.createElement('img');
      img.src = resolveAgentDisplayIcon(agent);
      img.alt = agent;
      img.style.width = '32px';
      img.style.height = '32px';
      iconDiv.appendChild(img);
      header.appendChild(iconDiv);

      const agentName = document.createElement('div');
      agentName.className = 'skill-card-title';
      agentName.textContent = agent;
      header.appendChild(agentName);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.alignItems = 'center';
      actions.style.gap = '8px';

      const edit = document.createElement('span');
      edit.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--vscode-foreground)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';
      edit.style.cursor = 'pointer';
      edit.title = 'Modifier cet agent';
      edit.addEventListener('click', function () {
        const targetAgent = (state.agents || []).find((entry) => normalizeAgentKey(entry.path || '') === agent)
          || { path: group.folder };
        openAgentFormForEdit(targetAgent);
      });

      const remove = document.createElement('span');
      remove.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c44" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-trash"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
      remove.style.cursor = 'pointer';
      remove.title = 'Supprimer cet agent';
      remove.addEventListener('click', function () {
        state.agents = (state.agents || []).filter((entry) => normalizeAgentKey(entry.path || '') !== agent);
        state.skillPaths = state.agents.map((entry) => entry.path);
        state.customAgentIcons = buildCustomAgentIconMapFromAgents(state.agents);
        sendSaveSkillConfig();
      });

      actions.appendChild(edit);
      actions.appendChild(remove);
      header.appendChild(actions);
      card.appendChild(header);

      // Ligne 2 : skills trouvés
      const skills = (group.skills || []).map(s => s.name);
      const skillsDiv = document.createElement('div');
      skillsDiv.className = 'skill-card-subtitle';
      skillsDiv.textContent = skills.length ? 'Skills : ' + skills.join(', ') : 'Aucun skill';
      card.appendChild(skillsDiv);

      // Ligne 3 : chemin dossier agent
      const pathDiv = document.createElement('div');
      pathDiv.style.fontSize = '0.9em';
      pathDiv.style.color = 'var(--vscode-descriptionForeground)';
      pathDiv.style.background = 'var(--vscode-editorWidget-background)';
      pathDiv.style.borderRadius = '6px';
      pathDiv.style.padding = '4px 8px';
      pathDiv.style.marginTop = '6px';
      pathDiv.style.alignSelf = 'flex-end';
      pathDiv.textContent = group.folder;
      card.appendChild(pathDiv);

      container.appendChild(card);
    });
    if (!state.installedSkills.length) {
      container.textContent = 'Aucun agent déclaré.';
    }
  }

  function renderMarketplace() {
    const repoContainer = byId('marketplace-repos');
    const skillsContainer = byId('marketplace-skills');
    const countLabel = byId('marketplace-count');
    const pageLabel = byId('marketplace-page-label');
    const prevButton = byId('marketplace-prev');
    const nextButton = byId('marketplace-next');
    if (!repoContainer || !skillsContainer) {
      return;
    }

    const filterInput = byId('marketplace-filter');
    const normalizedFilter = normalizeSkillToken(filterInput ? filterInput.value : '');

    const declaredAgents = getDeclaredAgents();
    const installedByAgent = getInstalledSkillsByAgent();
    const totalSkillsCount = state.marketplaceTotal || 0;
    const currentPage = state.marketplacePage || 0;
    const limit = state.marketplaceLimit || 50;
    const totalPages = limit > 0 ? Math.ceil(totalSkillsCount / limit) : 1;

    if (pageLabel) {
      pageLabel.textContent = `Page ${currentPage + 1} / ${totalPages}`;
    }
    if (prevButton) {
      prevButton.disabled = currentPage <= 0;
    }
    if (nextButton) {
      nextButton.disabled = currentPage >= totalPages - 1;
    }

    repoContainer.innerHTML = '';
    state.marketplaceSkills.forEach((repoGroup) => {
      const title = document.createElement('div');
      title.className = 'folder-title';
      title.textContent = repoGroup.repo;
      repoContainer.appendChild(title);
    });
    if (!state.marketplaceSkills.length) {
      repoContainer.textContent = 'Aucun repo configure.';
    }

    skillsContainer.innerHTML = '';
    let visibleSkillsCount = 0;
    state.marketplaceSkills.forEach((repoGroup) => {
      const allNamedSkills = (repoGroup.skills || []).filter((skill) => skill && skill.name);
      const filteredSkills = allNamedSkills.filter((skill) => skillMatchesFilter(skill, normalizedFilter));

      if (!filteredSkills.length) {
        const empty = document.createElement('div');
        empty.className = 'list-item';
        empty.textContent = normalizedFilter ? 'Aucun skill ne correspond au filtre.' : 'Aucun skill detecte.';
        skillsContainer.appendChild(empty);
        return;
      }

      filteredSkills.forEach((skill) => {
        const card = document.createElement('div');
        card.className = 'skill-card';

        const title = document.createElement('div');
        title.className = 'skill-card-title';
        title.textContent = skill.name;
        card.appendChild(title);

        const description = getMarketplaceSkillDescription(skill);
        if (description) {
          const subtitle = document.createElement('div');
          subtitle.className = 'skill-card-subtitle';
          subtitle.textContent = description;
          card.appendChild(subtitle);
        }

        const marketplaceSkillKeys = buildSkillMatchKeys(skill);

        if (declaredAgents.length) {
          const row = document.createElement('div');
          row.className = 'agent-icons';
          declaredAgents.forEach((agent) => {
            const isInstalled = hasSkillMatch(installedByAgent[agent], marketplaceSkillKeys);
            const icon = document.createElement('div');
            icon.className = 'agent-icon';
            if (isInstalled) {
              icon.classList.add('installed');
            }
            icon.style.cursor = 'pointer';
            const img = document.createElement('img');
            img.src = resolveAgentDisplayIcon(agent);
            img.alt = agent;
            icon.appendChild(img);
            icon.title = isInstalled ? (agent + ' - installé') : (agent + ' - non installé');
            icon.addEventListener('click', function () {
              const agentPath = getAgentPathByKey(agent);
              if (!agentPath) {
                setStatus(`Chemin non trouvé pour l'agent ${agent}.`, true);
                return;
              }
              vscode.postMessage({
                command: 'toggleMarketplaceSkill',
                data: {
                  agentPath,
                  agentKey: agent,
                  skillName: skill.name,
                  skillPath: skill.path,
                  install: !isInstalled,
                  repos: state.repos,
                  page: currentPage,
                  limit
                }
              });
              setStatus(isInstalled ? `Suppression de ${skill.name} pour ${agent}...` : `Installation de ${skill.name} pour ${agent}...`, false);
            });
            row.appendChild(icon);
          });
          card.appendChild(row);
        }

        skillsContainer.appendChild(card);
        visibleSkillsCount += 1;
      });
    });
    if (!state.marketplaceSkills.length) {
      skillsContainer.textContent = 'Aucun skill detecte.';
    } else if (normalizedFilter && visibleSkillsCount === 0) {
      skillsContainer.textContent = 'Aucun skill ne correspond au filtre saisi.';
    }

    if (countLabel) {
      if (!totalSkillsCount) {
        countLabel.textContent = '0 skill chargé';
      } else if (normalizedFilter) {
        countLabel.textContent = `${visibleSkillsCount.toLocaleString('fr-FR')} / ${totalSkillsCount.toLocaleString('fr-FR')} skills`;
      } else {
        countLabel.textContent = `${totalSkillsCount.toLocaleString('fr-FR')} skills`;
      }
    }
  }

  function renderRepoList() {
    // supprimé : plus d'affichage de la source unique
  }

  function refreshFilter() {
    renderMarketplace();
  }

  function normalizeAgentKey(folderPath) {
    const normalized = folderPath.replace(/\\/g, '/').replace(/\/+$|^\/+/, '');
    const segments = normalized.split('/').filter(Boolean);
    let key = segments[segments.length - 1] || '';
    if (key.toLowerCase() === 'skills' && segments.length > 1) {
      key = segments[segments.length - 2];
    }
    key = key.replace(/^\.+/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return key;
  }

  function buildCustomAgentIconMapFromAgents(agents) {
    const iconMap = {};
    (agents || []).forEach((agent) => {
      if (!agent || !agent.path || !agent.icon) {
        return;
      }
      const key = normalizeAgentKey(agent.path);
      if (!key) {
        return;
      }
      iconMap[key] = agent.icon;
    });
    return iconMap;
  }

  function getDeclaredAgents() {
    ensureAgentsStateSynced();
    const seen = new Set();
    return state.agents.map((entry) => normalizeAgentKey(entry.path)).filter((agent) => {
      if (!agent || seen.has(agent)) {
        return false;
      }
      seen.add(agent);
      return true;
    });
  }

  function getInstalledSkillsByAgent() {
    const result = {};
    state.installedSkills.forEach((group) => {
      const agent = normalizeAgentKey(group.folder);
      if (!agent) {
        return;
      }
      result[agent] = result[agent] || new Set();
      (group.skills || []).forEach((skill) => {
        const keys = buildSkillMatchKeys(skill);
        keys.forEach((key) => result[agent].add(key));
      });
    });
    return result;
  }

  function updateUi(newState) {
    state = newState || state;
    ensureAgentsStateSynced();
    state.customAgentIcons = buildCustomAgentIconMapFromAgents(state.agents);
    renderAgentCards();
    renderMarketplace();
  }

  function updateAgentIconPreview() {
    const preview = byId('new-agent-icon-preview');
    if (!preview) {
      return;
    }
    const select = byId('new-agent-icon-select');
    const presetKey = select ? select.value : '';
    let previewSrc = '';
    if (pendingCustomIcon) {
      previewSrc = pendingCustomIcon;
    } else if (presetKey) {
      previewSrc = resolveIconUrl(presetKey, agentIconMap);
    }
    if (!previewSrc) {
      preview.style.display = 'none';
      preview.removeAttribute('src');
      return;
    }
    preview.src = previewSrc;
    preview.style.display = 'block';
  }

  function populatePresetIconSelect() {
    const select = byId('new-agent-icon-select');
    if (!select) {
      return;
    }
    const current = select.value;
    select.innerHTML = '';
    const autoOption = document.createElement('option');
    autoOption.value = '';
    autoOption.textContent = 'Automatique (selon le nom agent)';
    select.appendChild(autoOption);
    getPresetIconKeys().forEach((key) => {
      const option = document.createElement('option');
      option.value = key;
      option.textContent = key;
      select.appendChild(option);
    });
    if ([...select.options].some((option) => option.value === current)) {
      select.value = current;
    } else {
      select.value = '';
    }
  }

  function resetAgentForm() {
    const pathInput = byId('new-agent-path');
    const fileInput = byId('new-agent-icon-file');
    const select = byId('new-agent-icon-select');
    if (pathInput) {
      pathInput.value = '';
    }
    if (fileInput) {
      fileInput.value = '';
    }
    if (select) {
      select.value = '';
    }
    pendingCustomIcon = '';
    updateAgentIconPreview();
  }

  function readCustomIconFromFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      pendingCustomIcon = typeof reader.result === 'string' ? reader.result : '';
      updateAgentIconPreview();
    };
    reader.readAsDataURL(file);
  }

  function bindActions() {
    const addAgent = byId('add-agent');
    if (addAgent) {
      addAgent.addEventListener('click', function () {
        const form = byId('agent-form');
        if (!form) {
          return;
        }
        if (form.hidden) {
          openAgentFormForCreate();
        } else {
          closeAgentForm();
        }
      });
    }

    const marketplaceFilter = byId('marketplace-filter');
    if (marketplaceFilter) {
      marketplaceFilter.addEventListener('input', function () {
        refreshFilter();
      });
    }

    const marketplacePrev = byId('marketplace-prev');
    if (marketplacePrev) {
      marketplacePrev.addEventListener('click', function () {
        const nextPage = Math.max(0, (state.marketplacePage || 0) - 1);
        loadMarketplacePage(nextPage);
      });
    }

    const marketplaceNext = byId('marketplace-next');
    if (marketplaceNext) {
      marketplaceNext.addEventListener('click', function () {
        const limit = state.marketplaceLimit || 50;
        const total = state.marketplaceTotal || 0;
        const maxPage = Math.max(0, Math.ceil(total / limit) - 1);
        const nextPage = Math.min(maxPage, (state.marketplacePage || 0) + 1);
        loadMarketplacePage(nextPage);
      });
    }

    const closeAgentFormButton = byId('close-agent-form');
    if (closeAgentFormButton) {
      closeAgentFormButton.addEventListener('click', function () {
        closeAgentForm();
      });
    }

    const cancelAgentButton = byId('cancel-agent');
    if (cancelAgentButton) {
      cancelAgentButton.addEventListener('click', function () {
        closeAgentForm();
      });
    }

    const iconSelect = byId('new-agent-icon-select');
    if (iconSelect) {
      iconSelect.addEventListener('change', function () {
        updateAgentIconPreview();
      });
    }

    const fileInput = byId('new-agent-icon-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        const file = fileInput.files && fileInput.files.length ? fileInput.files[0] : null;
        readCustomIconFromFile(file);
      });
    }

    const dropZone = byId('agent-icon-dropzone');
    if (dropZone) {
      dropZone.addEventListener('dragover', function (event) {
        event.preventDefault();
        dropZone.classList.add('dragover');
      });
      dropZone.addEventListener('dragleave', function () {
        dropZone.classList.remove('dragover');
      });
      dropZone.addEventListener('drop', function (event) {
        event.preventDefault();
        dropZone.classList.remove('dragover');
        const files = event.dataTransfer && event.dataTransfer.files;
        if (!files || !files.length) {
          return;
        }
        readCustomIconFromFile(files[0]);
      });
    }

    const clearIconButton = byId('clear-agent-icon');
    if (clearIconButton) {
      clearIconButton.addEventListener('click', function () {
        pendingCustomIcon = '';
        const iconFileInput = byId('new-agent-icon-file');
        if (iconFileInput) {
          iconFileInput.value = '';
        }
        updateAgentIconPreview();
      });
    }

    const saveAgent = byId('save-agent');
    if (saveAgent) {
      saveAgent.addEventListener('click', function () {
        const pathInput = byId('new-agent-path');
        const iconPresetInput = byId('new-agent-icon-select');
        if (!pathInput || !iconPresetInput) {
          return;
        }
        const normalizedPath = normalizeAgentPath(pathInput.value);
        if (!normalizedPath) {
          return;
        }
        const selectedPreset = iconPresetInput.value;
        const customIcon = pendingCustomIcon || '';
        const icon = customIcon || selectedPreset || undefined;
        const nextAgent = icon ? { path: normalizedPath, icon } : { path: normalizedPath };

        const nextAgents = Array.isArray(state.agents) ? state.agents.slice() : [];
        if (editingAgentKey) {
          const editingIndex = nextAgents.findIndex((entry) => normalizeAgentKey(entry.path || '') === editingAgentKey);
          if (editingIndex >= 0) {
            nextAgents[editingIndex] = nextAgent;
          } else {
            nextAgents.push(nextAgent);
          }
        } else {
          const existingIndex = nextAgents.findIndex((entry) => normalizeAgentKey(entry.path || '') === normalizeAgentKey(normalizedPath));
          if (existingIndex >= 0) {
            nextAgents[existingIndex] = nextAgent;
          } else {
            nextAgents.push(nextAgent);
          }
        }

        const dedupedAgents = [];
        const seenAgents = new Set();
        nextAgents.forEach((entry) => {
          const key = normalizeAgentKey(entry.path || '');
          if (!key || seenAgents.has(key)) {
            return;
          }
          seenAgents.add(key);
          dedupedAgents.push(entry);
        });

        state.agents = dedupedAgents;
        state.skillPaths = state.agents.map((entry) => entry.path);
        state.customAgentIcons = buildCustomAgentIconMapFromAgents(state.agents);
        sendSaveSkillConfig();
        closeAgentForm();
      });
    }
  }

  window.addEventListener('message', function (event) {
    const message = event.data;
    if (!message || !message.command) {
      return;
    }
    if (message.command === 'state') {
      updateUi(message.data);
      setStatus('', false);
    }
    if (message.command === 'installedSkills') {
      state.installedSkills = message.data || [];
      renderAgentCards();
    }
    if (message.command === 'marketplaceSkills') {
      state.marketplaceSkills = message.data || [];
      const firstGroup = Array.isArray(state.marketplaceSkills) && state.marketplaceSkills.length ? state.marketplaceSkills[0] : null;
      if (firstGroup) {
        state.marketplacePage = typeof firstGroup.page === 'number' ? firstGroup.page : 0;
        state.marketplaceLimit = typeof firstGroup.limit === 'number' ? firstGroup.limit : state.marketplaceLimit;
        state.marketplaceTotal = typeof firstGroup.total === 'number' ? firstGroup.total : state.marketplaceTotal;
      }
      renderMarketplace();
    }
  });

  bindActions();

  if (vscode) {
    setStatus('', false);
    vscode.postMessage({ command: 'loadState' });
  } else {
    setStatus('', true);
  }
})();
