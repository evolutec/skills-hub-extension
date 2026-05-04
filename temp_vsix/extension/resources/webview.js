(function () {
  let vscode;
  try {
    vscode = acquireVsCodeApi();
  } catch {
    vscode = undefined;
  }

  let state = { skillPaths: [], repos: [], installedSkills: [], marketplaceSkills: [], configFolderPath: '' };

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(message, isError) {
    const status = byId('status-text');
    if (!status) {
      return;
    }
    status.textContent = '';
    status.style.color = '';
  }

  function sendSaveSkillConfig() {
    if (!vscode) {
      setStatus('Impossible de sauvegarder: API VS Code introuvable.', true);
      return;
    }
    vscode.postMessage({ command: 'saveSkillConfig', data: { skillPaths: state.skillPaths } });
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

  function resolveIconUrl(icon, agentIconMap) {
    if (!icon) return '';
    const normalizedIcon = String(icon).trim();
    if (normalizedIcon.startsWith('http')) return normalizedIcon;
    if (normalizedIcon.startsWith('data:')) return normalizedIcon;
    const normalizedKey = normalizedIcon.toLowerCase();
    // Si c'est un chemin local, essayer de le résoudre via agentIconMap
    if (agentIconMap && agentIconMap[normalizedKey]) return agentIconMap[normalizedKey];
    // Si c'est un chemin relatif resources/ ou /resources/
    if (normalizedKey.includes('resources/')) {
      const fileName = normalizedKey.split('/').pop().split('?')[0].split('#')[0];
      const key = fileName.replace(/\.(svg|png|jpe?g|gif|webp)$/i, '');
      if (agentIconMap && agentIconMap[key]) return agentIconMap[key];
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

  function renderAgentCards() {
    const container = byId('agent-cards');
    if (!container) return;
    container.innerHTML = '';
    const declaredAgents = getDeclaredAgents();
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
      img.src = resolveIconUrl(agent, window.agentIconMap);
      img.alt = agent;
      img.style.width = '32px';
      img.style.height = '32px';
      iconDiv.appendChild(img);
      header.appendChild(iconDiv);

      const agentName = document.createElement('div');
      agentName.className = 'skill-card-title';
      agentName.textContent = agent;
      header.appendChild(agentName);

      const remove = document.createElement('span');
      remove.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c44" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-trash"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
      remove.style.cursor = 'pointer';
      remove.title = 'Supprimer cet agent';
      remove.addEventListener('click', function () {
        state.skillPaths = state.skillPaths.filter(p => normalizeAgentKey(p) !== agent);
        sendSaveSkillConfig();
      });
      header.appendChild(remove);
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
    if (!repoContainer || !skillsContainer) {
      return;
    }

    const declaredAgents = getDeclaredAgents();
    const installedByAgent = getInstalledSkillsByAgent();

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
    state.marketplaceSkills.forEach((repoGroup) => {
      const header = document.createElement('div');
      header.className = 'folder-title';
      header.textContent = repoGroup.repo;
      skillsContainer.appendChild(header);

      if (!repoGroup.skills || !repoGroup.skills.length) {
        const empty = document.createElement('div');
        empty.className = 'list-item';
        empty.textContent = 'Aucun skill detecte.';
        skillsContainer.appendChild(empty);
        return;
      }

      repoGroup.skills.forEach((skill) => {
        if (!skill.name) {
          const div = document.createElement('div');
          div.className = 'list-item';
          div.textContent = skill.entries.join('\n');
          skillsContainer.appendChild(div);
          return;
        }

        const card = document.createElement('div');
        card.className = 'skill-card';

        const title = document.createElement('div');
        title.className = 'skill-card-title';
        title.textContent = skill.name;
        card.appendChild(title);

        // Affichage de la description du skill
        if (skill.entries && skill.entries.length > 0 && typeof skill.entries[0] === 'string') {
          const desc = document.createElement('div');
          desc.className = 'skill-card-subtitle';
          desc.textContent = skill.entries[0];
          card.appendChild(desc);
        }

        // Affichage SVG du skill si présent dans entries
        // Recherche d'une icône SVG ou image dans entries
        const iconEntry = (skill.entries || []).find((e) => isImageLikeString(e));
        if (iconEntry) {
          const img = document.createElement('img');
          img.src = resolveIconUrl(iconEntry, window.agentIconMap);
          img.alt = skill.name;
          img.style.width = '32px';
          img.style.height = '32px';
          img.style.display = 'block';
          img.style.marginBottom = '8px';
          img.onerror = function() { img.style.display = 'none'; };
          card.appendChild(img);
        }

        if (declaredAgents.length) {
          const row = document.createElement('div');
          row.className = 'agent-icons';
          declaredAgents.forEach((agent) => {
            const isInstalled = installedByAgent[agent] && installedByAgent[agent].has(skill.name);
            const icon = document.createElement('div');
            icon.className = 'agent-icon';
            if (isInstalled) {
              icon.classList.add('installed');
            }
            const img = document.createElement('img');
            img.src = resolveIconUrl(agent, window.agentIconMap);
            img.alt = agent;
            icon.appendChild(img);
            const label = document.createElement('div');
            label.textContent = agent;
            icon.appendChild(label);
            row.appendChild(icon);
          });
          card.appendChild(row);
        }

        const installed = declaredAgents.some((agent) => installedByAgent[agent] && installedByAgent[agent].has(skill.name));
        const button = document.createElement('button');
        button.className = 'install-button ' + (installed ? 'installed' : 'available');
        button.textContent = installed ? 'Installé' : 'Installer';
        if (installed) {
          button.disabled = true;
        }
        card.appendChild(button);

        skillsContainer.appendChild(card);
      });
    });
    if (!state.marketplaceSkills.length) {
      skillsContainer.textContent = 'Aucun skill detecte.';
    }
  }

  function renderRepoList() {
    // supprimé : plus d'affichage de la source unique
  }

  function refreshFilter() {}

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

  function getDeclaredAgents() {
    const seen = new Set();
    return state.skillPaths.map(normalizeAgentKey).filter((agent) => {
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
        if (skill.name) {
          result[agent].add(skill.name);
        }
      });
    });
    return result;
  }

  function updateUi(newState) {
    state = newState || state;
    renderAgentCards();
    renderMarketplace();
  }

  function bindActions() {
    const addAgent = byId('add-agent');
    if (addAgent) {
      addAgent.addEventListener('click', function () {
        const input = byId('new-agent-path');
        if (!input) {
          return;
        }
        let value = input.value.trim();
        if (!value) {
          return;
        }
        // Ajoute automatiquement /skills si ce n'est pas déjà la fin du chemin
        if (!value.replace(/\\/g, '/').toLowerCase().endsWith('/skills')) {
          value = value.replace(/\\/g, '/') + '/skills';
        }
        state.skillPaths.push(value);
        input.value = '';
        sendSaveSkillConfig();
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
