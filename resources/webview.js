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
    status.textContent = message;
    status.style.color = isError ? 'var(--vscode-errorForeground)' : 'var(--vscode-descriptionForeground)';
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
    const info = byId('config-location-text');
    if (!info) {
      return;
    }
    const folder = state.configFolderPath || '';
    if (!folder) {
      info.textContent = 'Chemin de configuration indisponible.';
      return;
    }
    info.textContent = 'Les parametres sont sauvegardes dans : ' + folder + '\\config.json et ' + folder + '\\conf-repo.json';
  }

  function renderSkillPaths() {
    const container = byId('skill-paths');
    if (!container) {
      return;
    }
    container.innerHTML = '';
    state.skillPaths.forEach((skillPath, index) => {
      const div = document.createElement('div');
      div.className = 'list-item';
      div.textContent = skillPath;

      const remove = document.createElement('button');
      remove.textContent = 'Supprimer';
      remove.addEventListener('click', function () {
        state.skillPaths.splice(index, 1);
        sendSaveSkillConfig();
      });

      div.appendChild(remove);
      container.appendChild(div);
    });
    if (!state.skillPaths.length) {
      container.textContent = 'Aucun chemin configure.';
    }
  }

  function renderRepoList() {
    const container = byId('repo-list');
    if (!container) {
      return;
    }
    container.innerHTML = '';
    state.repos.forEach((repo, index) => {
      const div = document.createElement('div');
      div.className = 'list-item';
      div.textContent = repo;

      const remove = document.createElement('button');
      remove.textContent = 'Supprimer';
      remove.addEventListener('click', function () {
        state.repos.splice(index, 1);
        sendSaveRepoConfig();
      });

      div.appendChild(remove);
      container.appendChild(div);
    });
    if (!state.repos.length) {
      container.textContent = 'Aucun repo configure.';
    }
  }

  function renderInstalledSkills() {
    const filter = byId('installed-filter');
    const list = byId('installed-skills');
    if (!filter || !list) {
      return;
    }

    filter.innerHTML = '';
    state.skillPaths.forEach((skillPath) => {
      const option = document.createElement('option');
      option.value = skillPath;
      option.textContent = skillPath;
      filter.appendChild(option);
    });

    const selected = filter.value || state.skillPaths[0] || '';
    list.innerHTML = '';

    if (!selected) {
      list.textContent = 'Aucun skill a afficher. Ajoutez un chemin dans Parametres.';
      return;
    }

    const group = state.installedSkills.find((entry) => entry.folder === selected);
    if (!group || !group.skills || !group.skills.length) {
      list.textContent = 'Aucun skill detecte dans ce dossier.';
      return;
    }

    group.skills.forEach((skill) => {
      const card = document.createElement('div');
      card.className = 'skill-card';

      const title = document.createElement('div');
      title.className = 'skill-card-title';
      title.textContent = skill.name + '/';
      card.appendChild(title);

      if (skill.path && skill.path !== skill.name) {
        const subtitle = document.createElement('div');
        subtitle.className = 'skill-card-subtitle';
        subtitle.textContent = skill.path;
        card.appendChild(subtitle);
      }

      const tree = document.createElement('pre');
      tree.className = 'skill-tree';
      tree.textContent = skill.entries.join('\n');
      card.appendChild(tree);

      list.appendChild(card);
    });
  }

  function refreshFilter() {
    const filter = byId('installed-filter');
    if (!filter) {
      return;
    }
    filter.onchange = function () {
      renderInstalledSkills();
    };
  }

  function renderMarketplace() {
    const repoContainer = byId('marketplace-repos');
    const skillsContainer = byId('marketplace-skills');
    if (!repoContainer || !skillsContainer) {
      return;
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
        title.textContent = skill.name + '/';
        card.appendChild(title);

        if (skill.path) {
          const subtitle = document.createElement('div');
          subtitle.className = 'skill-card-subtitle';
          subtitle.textContent = skill.path;
          card.appendChild(subtitle);
        }

        const tree = document.createElement('pre');
        tree.className = 'skill-tree';
        tree.textContent = skill.entries.join('\n');
        card.appendChild(tree);

        skillsContainer.appendChild(card);
      });
    });
    if (!state.marketplaceSkills.length) {
      skillsContainer.textContent = 'Aucun skill detecte.';
    }
  }

  function updateUi(newState) {
    state = newState || state;
    renderConfigPath();
    renderSkillPaths();
    renderRepoList();
    renderInstalledSkills();
    renderMarketplace();
    refreshFilter();
  }

  function bindActions() {
    const addSkillPath = byId('add-skill-path');
    const addRepo = byId('add-repo');

    if (addSkillPath) {
      addSkillPath.addEventListener('click', function () {
        const input = byId('new-skill-path');
        if (!input) {
          return;
        }
        const value = input.value.trim();
        if (!value) {
          return;
        }
        state.skillPaths.push(value);
        input.value = '';
        sendSaveSkillConfig();
      });
    }

    if (addRepo) {
      addRepo.addEventListener('click', function () {
        const input = byId('new-repo');
        if (!input) {
          return;
        }
        const value = input.value.trim();
        if (!value) {
          return;
        }
        state.repos.push(value);
        input.value = '';
        sendSaveRepoConfig();
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
      setStatus('Configuration chargee.', false);
    }
    if (message.command === 'installedSkills') {
      state.installedSkills = message.data || [];
      renderInstalledSkills();
    }
    if (message.command === 'marketplaceSkills') {
      state.marketplaceSkills = message.data || [];
      renderMarketplace();
    }
  });

  bindActions();

  if (vscode) {
    setStatus('Chargement de la configuration...', false);
    vscode.postMessage({ command: 'loadState' });
  } else {
    setStatus('API VS Code introuvable: mode lecture seule.', true);
  }
})();
