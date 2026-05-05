(function () {
  let vscode;
  try {
    vscode = acquireVsCodeApi();
  } catch {
    vscode = undefined;
  }

  let state = { skillPaths: [], agents: [], customAgentIcons: {}, repos: [], installedSkills: [], marketplaceSkills: [], marketplacePage: 0, marketplaceLimit: 50, marketplaceTotal: 0, configFolderPath: '', language: 'en' };
  let pendingCustomIcon = '';
  let editingAgentKey = '';
  let marketplaceHoverLock = false;
  let marketplaceRenderPending = false;
  const SUPPORTED_LANGUAGES = ['en', 'es', 'zh', 'fr', 'ar'];
  const RTL_LANGUAGES = new Set(['ar']);
  const LOCALE_BY_LANGUAGE = {
    en: 'en-US',
    es: 'es-ES',
    zh: 'zh-CN',
    fr: 'fr-FR',
    ar: 'ar'
  };

  const COMMON_AGENT_PRESETS = [
    { value: 'copilot', label: 'Copilot', icon: 'copilot' },
    { value: 'claude', label: 'Claude', icon: 'claude' },
    { value: 'cline', label: 'Cline', icon: 'cline' },
    { value: 'roo', label: 'Roo', icon: 'roo' },
    { value: 'kilo', label: 'Kilo Code', icon: 'kilo-code' },
    { value: 'gemini', label: 'Gemini', icon: 'gemini' },
    { value: 'chatgpt', label: 'ChatGPT', icon: 'chatgpt' }
  ];

  const COMMON_AGENT_LABEL_BY_VALUE = COMMON_AGENT_PRESETS.reduce(function (acc, preset) {
    acc[preset.value] = preset.label;
    return acc;
  }, {});

  const TRANSLATIONS = {
    en: {
      'tab.marketplace': 'Marketplace',
      'tab.agents': 'Agents',
      'tab.settings': 'Settings',
      'marketplace.filterPlaceholder': 'Filter skills (name, namespace, description)',
      'marketplace.clearFilter': 'Clear filter',
      'marketplace.prev': 'Previous',
      'marketplace.next': 'Next',
      'marketplace.pageLabel': 'Page {page} / {total}',
      'marketplace.noRepoConfigured': 'No configured source.',
      'marketplace.noSkillDetected': 'No skills detected.',
      'marketplace.noSkillForFilter': 'No skills match the current filter.',
      'marketplace.countZero': '0 skills loaded',
      'marketplace.countFiltered': '{visible} / {total} skills',
      'marketplace.countAll': '{total} skills',
      'marketplace.agentInstalled': '{agent} - installed',
      'marketplace.agentNotInstalled': '{agent} - not installed',
      'marketplace.agentPathMissing': 'Path not found for agent {agent}.',
      'marketplace.installing': 'Installing {skill} for {agent}...',
      'marketplace.removing': 'Removing {skill} for {agent}...',
      'marketplace.openSkillPage': 'Open skill page',
      'agents.add': 'Add Agent',
      'agents.form.addTitle': 'Add Agent',
      'agents.form.editTitle': 'Edit Agent',
      'agents.form.closeAria': 'Close agent form',
      'agents.form.typeLabel': 'Agent type',
      'agents.form.typeCustom': 'Custom agent',
      'agents.form.nameLabel': 'Agent name',
      'agents.form.namePlaceholder': 'My custom agent',
      'agents.form.pathLabel': 'Agent path',
      'agents.form.pathPlaceholder': 'C:/Users/.../.roo/skills',
      'agents.form.presetIconLabel': 'Preset icon',
      'agents.form.customIconLabel': 'Custom icon (drag and drop or file picker)',
      'agents.form.dropzone': 'Drop an image file here, or click to choose.',
      'agents.form.clearCustomIcon': 'Remove custom icon',
      'agents.form.save': 'Save',
      'agents.form.cancel': 'Cancel',
      'agents.form.autoOption': 'Automatic (based on agent name)',
      'agents.noneDeclared': 'No agents declared.',
      'agents.noSkill': 'No skills',
      'agents.skillsList': 'Skills: {skills}',
      'agents.editAgent': 'Edit this agent',
      'agents.removeAgent': 'Remove this agent',
      'settings.title': 'Settings',
      'settings.languageLabel': 'Language',
      'settings.languageHint': 'Language is saved automatically.',
      'settings.languageSaved': 'Language updated.',
      'language.name.en': 'English',
      'language.name.es': 'Spanish',
      'language.name.zh': 'Chinese',
      'language.name.fr': 'French',
      'language.name.ar': 'Arabic',
      'status.apiMissingMarketplace': 'Cannot load marketplace: VS Code API unavailable.',
      'status.apiMissingSave': 'Cannot save: VS Code API unavailable.',
      'status.apiMissingRepoSave': 'Cannot save sources: VS Code API unavailable.',
      'status.pathsSaved': 'Settings saved.',
      'status.reposSaved': 'Source settings sent.',
      'status.apiUnavailable': 'VS Code API unavailable.'
    },
    es: {
      'tab.marketplace': 'Marketplace',
      'tab.agents': 'Agentes',
      'tab.settings': 'Configuración',
      'marketplace.filterPlaceholder': 'Filtrar skills (nombre, namespace, descripción)',
      'marketplace.clearFilter': 'Limpiar filtro',
      'marketplace.prev': 'Anterior',
      'marketplace.next': 'Siguiente',
      'marketplace.pageLabel': 'Página {page} / {total}',
      'marketplace.noRepoConfigured': 'Ninguna fuente configurada.',
      'marketplace.noSkillDetected': 'No se detectaron skills.',
      'marketplace.noSkillForFilter': 'Ningún skill coincide con el filtro actual.',
      'marketplace.countZero': '0 skills cargados',
      'marketplace.countFiltered': '{visible} / {total} skills',
      'marketplace.countAll': '{total} skills',
      'marketplace.agentInstalled': '{agent} - instalado',
      'marketplace.agentNotInstalled': '{agent} - no instalado',
      'marketplace.agentPathMissing': 'Ruta no encontrada para el agente {agent}.',
      'marketplace.installing': 'Instalando {skill} para {agent}...',
      'marketplace.removing': 'Eliminando {skill} de {agent}...',
      'agents.add': 'Agregar agente',
      'agents.form.addTitle': 'Agregar agente',
      'agents.form.editTitle': 'Editar agente',
      'agents.form.closeAria': 'Cerrar formulario de agente',
      'agents.form.pathLabel': 'Ruta del agente',
      'agents.form.pathPlaceholder': 'C:/Users/.../.roo/skills',
      'agents.form.presetIconLabel': 'Icono predefinido',
      'agents.form.customIconLabel': 'Icono personalizado (arrastrar y soltar o selector de archivo)',
      'agents.form.dropzone': 'Suelta una imagen aquí o haz clic para seleccionar.',
      'agents.form.clearCustomIcon': 'Quitar icono personalizado',
      'agents.form.save': 'Guardar',
      'agents.form.cancel': 'Cancelar',
      'agents.form.autoOption': 'Automático (según el nombre del agente)',
      'agents.noneDeclared': 'No hay agentes declarados.',
      'agents.noSkill': 'Sin skills',
      'agents.skillsList': 'Skills: {skills}',
      'agents.editAgent': 'Editar este agente',
      'agents.removeAgent': 'Eliminar este agente',
      'settings.title': 'Configuración',
      'settings.languageLabel': 'Idioma',
      'settings.languageHint': 'El idioma se guarda automáticamente.',
      'settings.languageSaved': 'Idioma actualizado.',
      'language.name.en': 'Inglés',
      'language.name.es': 'Español',
      'language.name.zh': 'Chino',
      'language.name.fr': 'Francés',
      'language.name.ar': 'Árabe',
      'status.apiMissingMarketplace': 'No se puede cargar el marketplace: API de VS Code no disponible.',
      'status.apiMissingSave': 'No se puede guardar: API de VS Code no disponible.',
      'status.apiMissingRepoSave': 'No se pueden guardar las fuentes: API de VS Code no disponible.',
      'status.pathsSaved': 'Configuración guardada.',
      'status.reposSaved': 'Configuración de fuentes enviada.',
      'status.apiUnavailable': 'API de VS Code no disponible.'
    },
    zh: {
      'tab.marketplace': '市场',
      'tab.agents': '代理',
      'tab.settings': '设置',
      'marketplace.filterPlaceholder': '筛选技能（名称、命名空间、描述）',
      'marketplace.clearFilter': '清除筛选',
      'marketplace.prev': '上一页',
      'marketplace.next': '下一页',
      'marketplace.pageLabel': '第 {page} / {total} 页',
      'marketplace.noRepoConfigured': '未配置来源。',
      'marketplace.noSkillDetected': '未检测到技能。',
      'marketplace.noSkillForFilter': '没有技能符合当前筛选条件。',
      'marketplace.countZero': '已加载 0 个技能',
      'marketplace.countFiltered': '{visible} / {total} 个技能',
      'marketplace.countAll': '{total} 个技能',
      'marketplace.agentInstalled': '{agent} - 已安装',
      'marketplace.agentNotInstalled': '{agent} - 未安装',
      'marketplace.agentPathMissing': '未找到代理 {agent} 的路径。',
      'marketplace.installing': '正在为 {agent} 安装 {skill}...',
      'marketplace.removing': '正在从 {agent} 移除 {skill}...',
      'agents.add': '添加代理',
      'agents.form.addTitle': '添加代理',
      'agents.form.editTitle': '编辑代理',
      'agents.form.closeAria': '关闭代理表单',
      'agents.form.pathLabel': '代理路径',
      'agents.form.pathPlaceholder': 'C:/Users/.../.roo/skills',
      'agents.form.presetIconLabel': '预设图标',
      'agents.form.customIconLabel': '自定义图标（拖放或文件选择）',
      'agents.form.dropzone': '将图片拖到这里，或点击选择。',
      'agents.form.clearCustomIcon': '移除自定义图标',
      'agents.form.save': '保存',
      'agents.form.cancel': '取消',
      'agents.form.autoOption': '自动（根据代理名称）',
      'agents.noneDeclared': '未声明任何代理。',
      'agents.noSkill': '无技能',
      'agents.skillsList': '技能：{skills}',
      'agents.editAgent': '编辑此代理',
      'agents.removeAgent': '删除此代理',
      'settings.title': '设置',
      'settings.languageLabel': '语言',
      'settings.languageHint': '语言会自动保存。',
      'settings.languageSaved': '语言已更新。',
      'language.name.en': '英语',
      'language.name.es': '西班牙语',
      'language.name.zh': '中文',
      'language.name.fr': '法语',
      'language.name.ar': '阿拉伯语',
      'status.apiMissingMarketplace': '无法加载市场：VS Code API 不可用。',
      'status.apiMissingSave': '无法保存：VS Code API 不可用。',
      'status.apiMissingRepoSave': '无法保存来源：VS Code API 不可用。',
      'status.pathsSaved': '设置已保存。',
      'status.reposSaved': '来源设置已发送。',
      'status.apiUnavailable': 'VS Code API 不可用。'
    },
    fr: {
      'tab.marketplace': 'Marketplace',
      'tab.agents': 'Agents',
      'tab.settings': 'Paramètres',
      'marketplace.filterPlaceholder': 'Filtrer les skills (nom, namespace, description)',
      'marketplace.clearFilter': 'Effacer le filtre',
      'marketplace.prev': 'Précédent',
      'marketplace.next': 'Suivant',
      'marketplace.pageLabel': 'Page {page} / {total}',
      'marketplace.noRepoConfigured': 'Aucune source configurée.',
      'marketplace.noSkillDetected': 'Aucun skill détecté.',
      'marketplace.noSkillForFilter': 'Aucun skill ne correspond au filtre actuel.',
      'marketplace.countZero': '0 skill chargé',
      'marketplace.countFiltered': '{visible} / {total} skills',
      'marketplace.countAll': '{total} skills',
      'marketplace.agentInstalled': '{agent} - installé',
      'marketplace.agentNotInstalled': '{agent} - non installé',
      'marketplace.agentPathMissing': 'Chemin non trouvé pour l\'agent {agent}.',
      'marketplace.installing': 'Installation de {skill} pour {agent}...',
      'marketplace.removing': 'Suppression de {skill} pour {agent}...',
      'agents.add': 'Ajouter agent',
      'agents.form.addTitle': 'Ajouter agent',
      'agents.form.editTitle': 'Modifier agent',
      'agents.form.closeAria': 'Fermer le formulaire agent',
      'agents.form.pathLabel': 'Chemin agent',
      'agents.form.pathPlaceholder': 'C:/Users/.../.roo/skills',
      'agents.form.presetIconLabel': 'Icône prédéfinie',
      'agents.form.customIconLabel': 'Icône personnalisée (glisser-déposer ou sélection fichier)',
      'agents.form.dropzone': 'Dépose un fichier image ici, ou clique pour choisir.',
      'agents.form.clearCustomIcon': 'Retirer l\'icône personnalisée',
      'agents.form.save': 'Sauvegarder',
      'agents.form.cancel': 'Annuler',
      'agents.form.autoOption': 'Automatique (selon le nom agent)',
      'agents.noneDeclared': 'Aucun agent déclaré.',
      'agents.noSkill': 'Aucun skill',
      'agents.skillsList': 'Skills : {skills}',
      'agents.editAgent': 'Modifier cet agent',
      'agents.removeAgent': 'Supprimer cet agent',
      'settings.title': 'Paramètres',
      'settings.languageLabel': 'Langue',
      'settings.languageHint': 'La langue est sauvegardée automatiquement.',
      'settings.languageSaved': 'Langue mise à jour.',
      'language.name.en': 'Anglais',
      'language.name.es': 'Espagnol',
      'language.name.zh': 'Chinois',
      'language.name.fr': 'Français',
      'language.name.ar': 'Arabe',
      'status.apiMissingMarketplace': 'Impossible de charger le marketplace : API VS Code introuvable.',
      'status.apiMissingSave': 'Impossible de sauvegarder : API VS Code introuvable.',
      'status.apiMissingRepoSave': 'Impossible de sauvegarder les sources : API VS Code introuvable.',
      'status.pathsSaved': 'Paramètres sauvegardés.',
      'status.reposSaved': 'Paramètres de source envoyés.',
      'status.apiUnavailable': 'API VS Code introuvable.'
    },
    ar: {
      'tab.marketplace': 'المتجر',
      'tab.agents': 'الوكلاء',
      'tab.settings': 'الإعدادات',
      'marketplace.filterPlaceholder': 'تصفية المهارات (الاسم، المجال، الوصف)',
      'marketplace.clearFilter': 'مسح عامل التصفية',
      'marketplace.prev': 'السابق',
      'marketplace.next': 'التالي',
      'marketplace.pageLabel': 'الصفحة {page} / {total}',
      'marketplace.noRepoConfigured': 'لا توجد مصادر مهيأة.',
      'marketplace.noSkillDetected': 'لم يتم اكتشاف أي مهارات.',
      'marketplace.noSkillForFilter': 'لا توجد مهارات تطابق عامل التصفية الحالي.',
      'marketplace.countZero': 'تم تحميل 0 مهارة',
      'marketplace.countFiltered': '{visible} / {total} مهارة',
      'marketplace.countAll': '{total} مهارة',
      'marketplace.agentInstalled': '{agent} - مثبت',
      'marketplace.agentNotInstalled': '{agent} - غير مثبت',
      'marketplace.agentPathMissing': 'تعذر العثور على المسار للوكيل {agent}.',
      'marketplace.installing': 'جارٍ تثبيت {skill} للوكيل {agent}...',
      'marketplace.removing': 'جارٍ إزالة {skill} من الوكيل {agent}...',
      'agents.add': 'إضافة وكيل',
      'agents.form.addTitle': 'إضافة وكيل',
      'agents.form.editTitle': 'تعديل وكيل',
      'agents.form.closeAria': 'إغلاق نموذج الوكيل',
      'agents.form.pathLabel': 'مسار الوكيل',
      'agents.form.pathPlaceholder': 'C:/Users/.../.roo/skills',
      'agents.form.presetIconLabel': 'أيقونة جاهزة',
      'agents.form.customIconLabel': 'أيقونة مخصصة (سحب وإفلات أو اختيار ملف)',
      'agents.form.dropzone': 'أسقط ملف صورة هنا أو انقر للاختيار.',
      'agents.form.clearCustomIcon': 'إزالة الأيقونة المخصصة',
      'agents.form.save': 'حفظ',
      'agents.form.cancel': 'إلغاء',
      'agents.form.autoOption': 'تلقائي (حسب اسم الوكيل)',
      'agents.noneDeclared': 'لا يوجد وكلاء معلنون.',
      'agents.noSkill': 'لا توجد مهارات',
      'agents.skillsList': 'المهارات: {skills}',
      'agents.editAgent': 'تعديل هذا الوكيل',
      'agents.removeAgent': 'حذف هذا الوكيل',
      'settings.title': 'الإعدادات',
      'settings.languageLabel': 'اللغة',
      'settings.languageHint': 'يتم حفظ اللغة تلقائيًا.',
      'settings.languageSaved': 'تم تحديث اللغة.',
      'language.name.en': 'الإنجليزية',
      'language.name.es': 'الإسبانية',
      'language.name.zh': 'الصينية',
      'language.name.fr': 'الفرنسية',
      'language.name.ar': 'العربية',
      'status.apiMissingMarketplace': 'تعذر تحميل المتجر: واجهة VS Code API غير متوفرة.',
      'status.apiMissingSave': 'تعذر الحفظ: واجهة VS Code API غير متوفرة.',
      'status.apiMissingRepoSave': 'تعذر حفظ المصادر: واجهة VS Code API غير متوفرة.',
      'status.pathsSaved': 'تم حفظ الإعدادات.',
      'status.reposSaved': 'تم إرسال إعدادات المصادر.',
      'status.apiUnavailable': 'واجهة VS Code API غير متوفرة.'
    }
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function normalizeLanguageCode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : 'en';
  }

  function getCurrentLanguage() {
    return normalizeLanguageCode(state.language);
  }

  function getCurrentLocale() {
    const language = getCurrentLanguage();
    return LOCALE_BY_LANGUAGE[language] || 'en-US';
  }

  function t(key, params) {
    const language = getCurrentLanguage();
    const dict = TRANSLATIONS[language] || TRANSLATIONS.en;
    const fallback = TRANSLATIONS.en[key] || key;
    const template = dict[key] || fallback;
    return template.replace(/\{(\w+)\}/g, function (_, token) {
      return params && Object.prototype.hasOwnProperty.call(params, token) ? String(params[token]) : '';
    });
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString(getCurrentLocale());
  }

  function setText(id, key, params) {
    const el = byId(id);
    if (!el) {
      return;
    }
    el.textContent = t(key, params);
  }

  function setPlaceholder(id, key) {
    const el = byId(id);
    if (!el) {
      return;
    }
    el.setAttribute('placeholder', t(key));
  }

  function applyLanguageDirection() {
    const language = getCurrentLanguage();
    document.documentElement.setAttribute('lang', language);
    document.documentElement.setAttribute('dir', RTL_LANGUAGES.has(language) ? 'rtl' : 'ltr');
  }

  function applyStaticTranslations() {
    setText('tab-label-marketplace', 'tab.marketplace');
    setText('tab-label-agents', 'tab.agents');
    setText('tab-label-settings', 'tab.settings');

    setPlaceholder('marketplace-filter', 'marketplace.filterPlaceholder');
    const marketplaceClearButton = byId('marketplace-filter-clear');
    if (marketplaceClearButton) {
      const clearLabel = t('marketplace.clearFilter');
      marketplaceClearButton.setAttribute('aria-label', clearLabel);
      marketplaceClearButton.setAttribute('title', clearLabel);
    }
    setText('marketplace-prev', 'marketplace.prev');
    setText('marketplace-next', 'marketplace.next');

    setText('add-agent', 'agents.add');
    setText('label-new-agent-kind', 'agents.form.typeLabel');
    setText('label-new-agent-name', 'agents.form.nameLabel');
    setPlaceholder('new-agent-name', 'agents.form.namePlaceholder');
    setText('label-new-agent-path', 'agents.form.pathLabel');
    setPlaceholder('new-agent-path', 'agents.form.pathPlaceholder');
    setText('label-new-agent-icon-select', 'agents.form.presetIconLabel');
    setText('label-new-agent-icon-file', 'agents.form.customIconLabel');
    setText('agent-icon-dropzone', 'agents.form.dropzone');
    setText('clear-agent-icon', 'agents.form.clearCustomIcon');
    setText('save-agent', 'agents.form.save');
    setText('cancel-agent', 'agents.form.cancel');

    const closeButton = byId('close-agent-form');
    if (closeButton) {
      closeButton.setAttribute('aria-label', t('agents.form.closeAria'));
    }

    const languageSelect = byId('settings-language-select');
    if (languageSelect) {
      Array.from(languageSelect.options).forEach(function (option) {
        option.textContent = t('language.name.' + option.value);
      });
      languageSelect.value = getCurrentLanguage();
    }

    setText('settings-section-title', 'settings.title');
    setText('settings-language-label', 'settings.languageLabel');
    setText('settings-language-hint', 'settings.languageHint');
    setAgentFormTitle(editingAgentKey ? t('agents.form.editTitle') : t('agents.form.addTitle'));
    populateAgentTypeSelect();
    updateMarketplaceFilterClearVisibility();
  }

  function applyLanguageUi() {
    applyLanguageDirection();
    applyStaticTranslations();
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

  function getCommonAgentPresetByValue(value) {
    return COMMON_AGENT_PRESETS.find((preset) => preset.value === value) || null;
  }

  function getCommonAgentPresetFromKey(agentKey) {
    const normalized = String(agentKey || '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    const aliases = {
      'roo-code': 'roo',
      kilocode: 'kilo',
      'kilo-code': 'kilo'
    };
    const mapped = aliases[normalized] || normalized;
    return getCommonAgentPresetByValue(mapped);
  }

  function getCommonAgentPresetFromAgent(agent) {
    const path = normalizeAgentPath(agent && agent.path ? agent.path : '');
    const byPath = getCommonAgentPresetFromKey(normalizeAgentKey(path));
    if (byPath) {
      return byPath;
    }

    const rawName = agent && typeof agent.name === 'string' ? agent.name.trim().toLowerCase() : '';
    if (!rawName) {
      return null;
    }
    return COMMON_AGENT_PRESETS.find((preset) => preset.label.toLowerCase() === rawName) || null;
  }

  function getAgentDisplayName(agent) {
    if (agent && typeof agent.name === 'string' && agent.name.trim()) {
      return agent.name.trim();
    }
    const fallbackKey = normalizeAgentKey(agent && agent.path ? agent.path : '');
    const commonPreset = getCommonAgentPresetFromKey(fallbackKey);
    return commonPreset ? commonPreset.label : fallbackKey;
  }

  function getAgentByPath(folderPath) {
    if (!Array.isArray(state.agents)) {
      return null;
    }
    const normalizedFolder = normalizeAgentPath(folderPath || '');
    return state.agents.find((entry) => normalizeAgentPath(entry.path || '') === normalizedFolder) || null;
  }

  function populateAgentTypeSelect() {
    const select = byId('new-agent-kind');
    if (!select) {
      return;
    }

    const current = select.value;
    select.innerHTML = '';

    COMMON_AGENT_PRESETS.forEach(function (preset) {
      const option = document.createElement('option');
      option.value = preset.value;
      option.textContent = preset.label;
      select.appendChild(option);
    });

    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = t('agents.form.typeCustom');
    select.appendChild(customOption);

    if ([...select.options].some((option) => option.value === current)) {
      select.value = current;
    } else {
      select.value = 'copilot';
    }

    updateAgentTypeUi();
  }

  function updateAgentTypeUi() {
    const typeSelect = byId('new-agent-kind');
    const nameWrap = byId('new-agent-name-wrap');
    const nameInput = byId('new-agent-name');
    const iconSelect = byId('new-agent-icon-select');
    if (!typeSelect || !nameWrap || !nameInput || !iconSelect) {
      return;
    }

    const selectedType = typeSelect.value;
    const custom = selectedType === 'custom';
    nameWrap.hidden = !custom;
    nameInput.disabled = !custom;

    if (!custom) {
      const preset = getCommonAgentPresetByValue(selectedType);
      if (preset) {
        nameInput.value = preset.label;
        if (!pendingCustomIcon && [...iconSelect.options].some((option) => option.value === preset.icon)) {
          iconSelect.value = preset.icon;
        }
      }
    }

    updateAgentIconPreview();
  }

  function loadMarketplacePage(page) {
    if (!vscode) {
      setStatus(t('status.apiMissingMarketplace'), true);
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
    setAgentFormTitle(t('agents.form.addTitle'));
    resetAgentForm();
  }

  function openAgentFormForCreate() {
    const form = byId('agent-form');
    if (!form) {
      return;
    }
    editingAgentKey = '';
    setAgentFormTitle(t('agents.form.addTitle'));
    populatePresetIconSelect();
    populateAgentTypeSelect();
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
    const typeSelect = byId('new-agent-kind');
    const nameInput = byId('new-agent-name');
    if (!form || !pathInput || !select || !typeSelect || !nameInput) {
      return;
    }

    const normalizedPath = normalizeAgentPath(agent && agent.path ? agent.path : '');
    if (!normalizedPath) {
      return;
    }

    editingAgentKey = normalizeAgentKey(normalizedPath);
    setAgentFormTitle(t('agents.form.editTitle'));
    populatePresetIconSelect();
    populateAgentTypeSelect();
    resetAgentForm();

    pathInput.value = normalizedPath;

    const commonPreset = getCommonAgentPresetFromAgent(agent);
    typeSelect.value = commonPreset ? commonPreset.value : 'custom';
    nameInput.value = agent && typeof agent.name === 'string' ? agent.name.trim() : '';
    updateAgentTypeUi();

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

  function sendSaveSkillConfig(options) {
    const silent = options && options.silent;
    if (!vscode) {
      setStatus(t('status.apiMissingSave'), true);
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
        const name = typeof agent.name === 'string' && agent.name.trim() ? agent.name.trim() : undefined;
        const payload = { path: normalizedPath };
        if (icon) {
          payload.icon = icon;
        }
        if (name) {
          payload.name = name;
        }
        return payload;
      })
      .filter(Boolean);
    vscode.postMessage({
      command: 'saveSkillConfig',
      data: {
        agents: cleanedAgents,
        skillPaths: cleanedAgents.map((agent) => agent.path),
        language: getCurrentLanguage()
      }
    });
    if (!silent) {
      setStatus(t('status.pathsSaved'), false);
    }
  }

  function sendSaveRepoConfig() {
    if (!vscode) {
      setStatus(t('status.apiMissingRepoSave'), true);
      return;
    }
    vscode.postMessage({ command: 'saveRepoConfig', data: { repos: state.repos } });
    setStatus(t('status.reposSaved'), false);
  }

  function renderConfigPath() {
    // supprimé : plus d'affichage du chemin de config
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

  function getMarketplaceSkillUrl(skill) {
    if (skill && typeof skill.sourceUrl === 'string' && /^https?:\/\//i.test(skill.sourceUrl.trim())) {
      return skill.sourceUrl.trim();
    }

    if (skill && Array.isArray(skill.entries)) {
      for (const entry of skill.entries) {
        if (typeof entry === 'string' && /^https?:\/\//i.test(entry.trim())) {
          return entry.trim();
        }
      }
    }

    return '';
  }

  function buildMarketplaceSkillKey(skill) {
    if (!skill || typeof skill !== 'object') {
      return '';
    }
    const byName = normalizeSkillToken(skill.name || '');
    if (byName) {
      return byName;
    }
    const byPath = normalizeSkillToken(skill.path || '');
    if (byPath) {
      return byPath;
    }
    return normalizeSkillToken(getMarketplaceSkillUrl(skill));
  }

  function openExternalUrl(url) {
    if (!url) {
      return;
    }
    if (vscode) {
      vscode.postMessage({ command: 'openExternal', data: { url: url } });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function renderAgentCards() {
    const container = byId('agent-cards');
    if (!container) return;
    container.innerHTML = '';
    ensureAgentsStateSynced();

    state.installedSkills.forEach((group) => {
      const normalizedFolderPath = normalizeAgentPath(group.folder || '');
      const agent = getAgentByPath(normalizedFolderPath) || { path: normalizedFolderPath };
      const agentKey = normalizeAgentKey(agent.path || normalizedFolderPath);
      if (!agentKey) return;
      const agentLabel = getAgentDisplayName(agent);
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
      img.src = resolveAgentDisplayIcon(agentKey);
      img.alt = agentLabel;
      img.style.width = '32px';
      img.style.height = '32px';
      iconDiv.appendChild(img);
      header.appendChild(iconDiv);

      const agentName = document.createElement('div');
      agentName.className = 'skill-card-title';
      agentName.textContent = agentLabel;
      header.appendChild(agentName);

      const actions = document.createElement('div');
      actions.style.display = 'flex';
      actions.style.alignItems = 'center';
      actions.style.gap = '8px';

      const edit = document.createElement('span');
      edit.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--vscode-foreground)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';
      edit.style.cursor = 'pointer';
      edit.title = t('agents.editAgent');
      edit.addEventListener('click', function () {
        const targetAgent = (state.agents || []).find((entry) => normalizeAgentKey(entry.path || '') === agentKey)
          || { path: group.folder };
        openAgentFormForEdit(targetAgent);
      });

      const remove = document.createElement('span');
      remove.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#c44" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="feather feather-trash"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';
      remove.style.cursor = 'pointer';
      remove.title = t('agents.removeAgent');
      remove.addEventListener('click', function () {
        state.agents = (state.agents || []).filter((entry) => normalizeAgentKey(entry.path || '') !== agentKey);
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
      skillsDiv.textContent = skills.length
        ? t('agents.skillsList', { skills: skills.join(', ') })
        : t('agents.noSkill');
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
      container.textContent = t('agents.noneDeclared');
    }
  }

  function renderMarketplace() {
    marketplaceRenderPending = false;
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
      pageLabel.textContent = t('marketplace.pageLabel', { page: currentPage + 1, total: totalPages || 1 });
    }
    if (prevButton) {
      prevButton.disabled = currentPage <= 0;
    }
    if (nextButton) {
      nextButton.disabled = currentPage >= totalPages - 1;
    }

    const marketplaceGroups = Array.isArray(state.marketplaceSkills) ? state.marketplaceSkills : [];

    repoContainer.innerHTML = '';
    marketplaceGroups.forEach((repoGroup) => {
      const title = document.createElement('div');
      title.className = 'folder-title';
      title.textContent = repoGroup.repo;
      repoContainer.appendChild(title);
    });
    if (!marketplaceGroups.length) {
      repoContainer.textContent = t('marketplace.noRepoConfigured');
    }

    skillsContainer.innerHTML = '';
    const allNamedSkills = marketplaceGroups.flatMap(function (repoGroup) {
      return (repoGroup.skills || []).filter(function (skill) {
        return skill && skill.name;
      });
    });

    const seenSkillKeys = new Set();
    const displaySkills = [];
    allNamedSkills.forEach(function (skill) {
      const dedupKey = buildMarketplaceSkillKey(skill);
      if (dedupKey && seenSkillKeys.has(dedupKey)) {
        return;
      }

      if (!skillMatchesFilter(skill, normalizedFilter)) {
        return;
      }

      if (dedupKey) {
        seenSkillKeys.add(dedupKey);
      }

      const marketplaceSkillKeys = buildSkillMatchKeys(skill);
      const installedOnAtLeastOneAgent = declaredAgents.some(function (agent) {
        return hasSkillMatch(installedByAgent[agent.key], marketplaceSkillKeys);
      });

      displaySkills.push({
        skill: skill,
        marketplaceSkillKeys: marketplaceSkillKeys,
        installedOnAtLeastOneAgent: installedOnAtLeastOneAgent
      });
    });

    displaySkills.sort(function (a, b) {
      if (a.installedOnAtLeastOneAgent !== b.installedOnAtLeastOneAgent) {
        return a.installedOnAtLeastOneAgent ? -1 : 1;
      }
      return String(a.skill.name || '').localeCompare(String(b.skill.name || ''), undefined, { sensitivity: 'base' });
    });

    let visibleSkillsCount = 0;
    displaySkills.forEach((entry) => {
        const skill = entry.skill;
        const marketplaceSkillKeys = entry.marketplaceSkillKeys;
        const card = document.createElement('div');
        card.className = 'skill-card';
        card.addEventListener('mouseenter', function () {
          marketplaceHoverLock = true;
        });
        card.addEventListener('mouseleave', function () {
          marketplaceHoverLock = false;
          if (marketplaceRenderPending) {
            requestMarketplaceRender();
          }
        });

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

        const skillUrl = getMarketplaceSkillUrl(skill);
        if (skillUrl) {
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'skill-page-link';
          link.textContent = t('marketplace.openSkillPage');
          link.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            openExternalUrl(skillUrl);
          });
          card.appendChild(link);
        }

        if (declaredAgents.length) {
          const row = document.createElement('div');
          row.className = 'agent-icons';
          declaredAgents.forEach((agent) => {
            const isInstalled = hasSkillMatch(installedByAgent[agent.key], marketplaceSkillKeys);
            const icon = document.createElement('div');
            icon.className = 'agent-icon';
            if (isInstalled) {
              icon.classList.add('installed');
            }
            icon.style.cursor = 'pointer';
            const img = document.createElement('img');
            img.src = resolveAgentDisplayIcon(agent.key);
            img.alt = agent.label;
            icon.appendChild(img);
            icon.title = isInstalled
              ? t('marketplace.agentInstalled', { agent: agent.label })
              : t('marketplace.agentNotInstalled', { agent: agent.label });
            icon.addEventListener('click', function () {
              const currentlyInstalled = icon.classList.contains('installed');
              const nextInstalled = !currentlyInstalled;

              // Apply immediate visual feedback while card reordering remains deferred on hover.
              if (nextInstalled) {
                icon.classList.add('installed');
              } else {
                icon.classList.remove('installed');
              }
              icon.title = nextInstalled
                ? t('marketplace.agentInstalled', { agent: agent.label })
                : t('marketplace.agentNotInstalled', { agent: agent.label });

              if (!vscode) {
                if (currentlyInstalled) {
                  icon.classList.add('installed');
                } else {
                  icon.classList.remove('installed');
                }
                setStatus(t('status.apiUnavailable'), true);
                return;
              }
              if (!agent.path) {
                if (currentlyInstalled) {
                  icon.classList.add('installed');
                } else {
                  icon.classList.remove('installed');
                }
                setStatus(t('marketplace.agentPathMissing', { agent: agent.label }), true);
                return;
              }
              vscode.postMessage({
                command: 'toggleMarketplaceSkill',
                data: {
                  agentPath: agent.path,
                  agentKey: agent.key,
                  skillName: skill.name,
                  skillPath: skill.path,
                  install: nextInstalled,
                  repos: state.repos,
                  page: currentPage,
                  limit
                }
              });
              setStatus(
                currentlyInstalled
                  ? t('marketplace.removing', { skill: skill.name, agent: agent.label })
                  : t('marketplace.installing', { skill: skill.name, agent: agent.label }),
                false
              );
            });
            row.appendChild(icon);
          });
          card.appendChild(row);
        }

        skillsContainer.appendChild(card);
        visibleSkillsCount += 1;
    });

    const hasActiveFilter = Boolean(normalizedFilter);
    if (!marketplaceGroups.length) {
      skillsContainer.textContent = t('marketplace.noSkillDetected');
    } else if (hasActiveFilter && visibleSkillsCount === 0) {
      skillsContainer.textContent = t('marketplace.noSkillForFilter');
    }

    if (countLabel) {
      if (!totalSkillsCount) {
        countLabel.textContent = t('marketplace.countZero');
      } else if (hasActiveFilter) {
        countLabel.textContent = t('marketplace.countFiltered', {
          visible: formatNumber(visibleSkillsCount),
          total: formatNumber(totalSkillsCount)
        });
      } else {
        countLabel.textContent = t('marketplace.countAll', { total: formatNumber(totalSkillsCount) });
      }
    }
  }

  function renderRepoList() {
    // supprimé : plus d'affichage de la source unique
  }

  function refreshFilter() {
    updateMarketplaceFilterClearVisibility();
    renderMarketplace();
  }

  function updateMarketplaceFilterClearVisibility() {
    const filterInput = byId('marketplace-filter');
    const clearButton = byId('marketplace-filter-clear');
    if (!filterInput || !clearButton) {
      return;
    }
    clearButton.hidden = String(filterInput.value || '').length === 0;
  }

  function requestMarketplaceRender() {
    // Keep card position stable while user is toggling agent icons on a hovered card.
    if (marketplaceHoverLock) {
      marketplaceRenderPending = true;
      return;
    }
    marketplaceRenderPending = false;
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
    const declared = [];
    (state.agents || []).forEach((entry) => {
      const normalizedPath = normalizeAgentPath(entry && entry.path ? entry.path : '');
      const key = normalizeAgentKey(normalizedPath);
      if (!key || seen.has(key)) {
        return;
      }
      seen.add(key);
      declared.push({
        key: key,
        path: normalizedPath,
        label: getAgentDisplayName(entry)
      });
    });
    return declared;
  }

  function getInstalledSkillsByAgent() {
    const result = {};
    const declaredByPath = new Map();
    getDeclaredAgents().forEach((agent) => {
      declaredByPath.set(normalizeAgentPath(agent.path), agent.key);
    });

    state.installedSkills.forEach((group) => {
      const normalizedFolder = normalizeAgentPath(group.folder || '');
      const agent = declaredByPath.get(normalizedFolder) || normalizeAgentKey(normalizedFolder);
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

  function syncMarketplaceMetaFromGroups() {
    const firstGroup = Array.isArray(state.marketplaceSkills) && state.marketplaceSkills.length
      ? state.marketplaceSkills[0]
      : null;

    if (!firstGroup) {
      if (typeof state.marketplacePage !== 'number' || state.marketplacePage < 0) {
        state.marketplacePage = 0;
      }
      if (typeof state.marketplaceLimit !== 'number' || state.marketplaceLimit <= 0) {
        state.marketplaceLimit = 50;
      }
      if (typeof state.marketplaceTotal !== 'number' || state.marketplaceTotal < 0) {
        state.marketplaceTotal = 0;
      }
      return;
    }

    if (typeof firstGroup.page === 'number' && firstGroup.page >= 0) {
      state.marketplacePage = firstGroup.page;
    }
    if (typeof firstGroup.limit === 'number' && firstGroup.limit > 0) {
      state.marketplaceLimit = firstGroup.limit;
    }
    if (typeof firstGroup.total === 'number' && firstGroup.total >= 0) {
      state.marketplaceTotal = firstGroup.total;
    }
  }

  function updateUi(newState) {
    state = Object.assign({}, state, newState || {});
    state.language = normalizeLanguageCode(state.language);
    ensureAgentsStateSynced();
    state.customAgentIcons = buildCustomAgentIconMapFromAgents(state.agents);
    syncMarketplaceMetaFromGroups();
    applyLanguageUi();
    renderAgentCards();
    requestMarketplaceRender();
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
    autoOption.textContent = t('agents.form.autoOption');
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
    const typeSelect = byId('new-agent-kind');
    const nameInput = byId('new-agent-name');
    if (pathInput) {
      pathInput.value = '';
    }
    if (fileInput) {
      fileInput.value = '';
    }
    if (select) {
      select.value = '';
    }
    if (typeSelect) {
      typeSelect.value = 'copilot';
    }
    if (nameInput) {
      nameInput.value = '';
    }
    pendingCustomIcon = '';
    updateAgentTypeUi();
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
    document.addEventListener('mouseleave', function () {
      marketplaceHoverLock = false;
      if (marketplaceRenderPending) {
        requestMarketplaceRender();
      }
    });

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

    const marketplaceFilterClear = byId('marketplace-filter-clear');
    if (marketplaceFilterClear) {
      marketplaceFilterClear.addEventListener('click', function () {
        const filterInput = byId('marketplace-filter');
        if (!filterInput) {
          return;
        }
        filterInput.value = '';
        refreshFilter();
        filterInput.focus();
      });
    }

    const languageSelect = byId('settings-language-select');
    if (languageSelect) {
      languageSelect.addEventListener('change', function () {
        const nextLanguage = normalizeLanguageCode(languageSelect.value);
        if (nextLanguage === getCurrentLanguage()) {
          return;
        }
        state.language = nextLanguage;
        applyLanguageUi();
        renderAgentCards();
        renderMarketplace();
        sendSaveSkillConfig({ silent: true });
        setStatus(t('settings.languageSaved'), false);
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

    const agentTypeSelect = byId('new-agent-kind');
    if (agentTypeSelect) {
      agentTypeSelect.addEventListener('change', function () {
        updateAgentTypeUi();
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
        const typeInput = byId('new-agent-kind');
        const nameInput = byId('new-agent-name');
        if (!pathInput || !iconPresetInput || !typeInput || !nameInput) {
          return;
        }
        const normalizedPath = normalizeAgentPath(pathInput.value);
        if (!normalizedPath) {
          return;
        }
        const selectedType = typeInput.value;
        const commonPreset = getCommonAgentPresetByValue(selectedType);
        let selectedPreset = iconPresetInput.value;
        if (!selectedPreset && commonPreset) {
          selectedPreset = commonPreset.icon;
        }

        let agentName = '';
        if (selectedType === 'custom') {
          agentName = String(nameInput.value || '').trim();
          if (!agentName) {
            agentName = getPathLeaf(normalizedPath) || normalizeAgentKey(normalizedPath);
          }
        } else if (commonPreset) {
          agentName = commonPreset.label;
        }

        const customIcon = pendingCustomIcon || '';
        const icon = customIcon || selectedPreset || undefined;
        const nextAgent = { path: normalizedPath };
        if (icon) {
          nextAgent.icon = icon;
        }
        if (agentName) {
          nextAgent.name = agentName;
        }

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
      requestMarketplaceRender();
    }
    if (message.command === 'marketplaceSkills') {
      state.marketplaceSkills = message.data || [];
      syncMarketplaceMetaFromGroups();
      requestMarketplaceRender();
    }
  });

  bindActions();
  applyLanguageUi();

  if (vscode) {
    setStatus('', false);
    vscode.postMessage({ command: 'loadState' });
  } else {
    setStatus(t('status.apiUnavailable'), true);
  }
})();
