import type { LucideIcon } from "lucide-react";

export interface Translations {
  // Locale meta
  locale: {
    localName: string;
  };

  capabilities: {
    integrationSkills: string;
    sharedSkills: string;
    title: string;
    description: string;
    plugins: string;
    skills: string;
    searchPlugins: string;
    searchSkills: string;
    allPlugins: string;
    installed: string;
    enabled: string;
    disabled: string;
    configure: string;
    details: string;
    addPlugin: string;
    builtin: string;
    community: string;
    custom: string;
    allSkills: string;
    availablePlugins: string;
    availableSkills: string;
    pluginHint: string;
    skillHint: string;
    noResults: string;
    larkName: string;
    larkDescription: string;
    larkTag: string;
    larkStatusUnavailable: string;
    retryIntegrationStatus: string;
    connect: string;
    notInstalled: string;
    mcpDescription: string;
    mcpLabel: string;
    pluginSettings: string;
    communityTitle: string;
    communityDescription: string;
    skillEnabled: string;
    manage: string;
  };

  // Common
  common: {
    home: string;
    settings: string;
    delete: string;
    edit: string;
    rename: string;
    renameFailed: string;
    share: string;
    openInNewWindow: string;
    close: string;
    more: string;
    search: string;
    loadMore: string;
    showingOf: (loaded: number, total: number) => string;
    download: string;
    thinking: string;
    artifacts: string;
    public: string;
    custom: string;
    notAvailableInDemoMode: string;
    loading: string;
    error: string;
    version: string;
    lastUpdated: string;
    code: string;
    preview: string;
    cancel: string;
    save: string;
    install: string;
    create: string;
    import: string;
    export: string;
    exportAsMarkdown: string;
    exportAsJSON: string;
    exportSuccess: string;
    exportFailed: string;
    regenerate: string;
    editAndRerun: string;
    editMessageContent: string;
    updateAndRerun: string;
    editRerunWarning: string;
    branch: string;
    showArtifacts: string;
    browser: string;
    showBrowser: string;
  };

  browserView: {
    browser: string;
    back: string;
    forward: string;
    urlLabel: string;
    urlPlaceholder: string;
    stopLiveControl: string;
    takeLiveControl: string;
    live: string;
    connecting: string;
    close: string;
    screenshotAlt: string;
    connectingTitle: string;
    noActivityTitle: string;
    waitingFirstFrame: string;
    emptyDescription: string;
    cannotOpen: (url?: string) => string;
    navigationNoScreenshot: string;
  };

  runDuration: {
    reasoning: string;
    working: string;
    completedIn: (duration: string) => string;
    description: string;
    lessThanSecond: string;
    hours: (value: number) => string;
    minutes: (value: number) => string;
    seconds: (value: number) => string;
    separator: string;
  };

  messageFeedback: {
    groupLabel: string;
    positive: string;
    negative: string;
    removePositive: string;
    removeNegative: string;
    removePermissionRequired: string;
  };

  home: {
    docs: string;
    blog: string;
  };

  // Welcome
  welcome: {
    workspaceLabel: string;
    greeting: string;
    description: string;
    createYourOwnSkill: string;
    createYourOwnSkillDescription: string;
  };

  // Clipboard
  clipboard: {
    copyToClipboard: string;
    copiedToClipboard: string;
    failedToCopyToClipboard: string;
    linkCopied: string;
  };

  artifactEditing: {
    unsaved: string;
    saving: string;
    saved: string;
    exit: string;
    discard: string;
    discardChanges: string;
    conflict: string;
    conflictShort: string;
    runInProgress: string;
    saveFailed: string;
  };

  artifactPreview: {
    limited: (previewSize: string, totalSize?: string) => string;
    loadFullFile: string;
    loadingFullFile: string;
    previewFailed: string;
    viewSource: string;
    selectFileLabel: string;
    missingTarget: string;
  };

  artifactTable: {
    title: string;
    header: string;
    column: (index: number) => string;
    total: (count: number) => string;
    sample: (count: number) => string;
    range: (start: number, end: number, limited: boolean) => string;
    columnsLimited: string;
    uneven: string;
    empty: string;
    incomplete: string;
    failed: string;
    retry: string;
    previous: string;
    next: string;
    cell: (row: number, column: number) => string;
    cellValue: string;
    missing: string;
    savedVersion: string;
  };

  artifactArchive: {
    downloadCurrent: (count: number) => string;
    currentVersionNotice: string;
    downloadFailed: string;
    runUnavailable: string;
    runNotReady: string;
    archiveTooLarge: string;
    archiveBusy: string;
  };

  modelPicker: {
    title: string;
    favorites: string;
    otherModels: string;
    noModels: string;
    favoriteModel: (displayName: string, name: string) => string;
    sessionOnly: string;
  };

  // Citations
  citations: {
    sourcesSummary: (count: number) => string;
    citeCount: (count: number) => string;
    copyReference: (title: string) => string;
    copiedReference: (title: string) => string;
  };

  // Workspace Changes
  workspaceChanges: {
    title: string;
    editedTitle: (count: number) => string;
    badge: (count: number, additions: number, deletions: number) => string;
    viewChanges: string;
    created: string;
    modified: string;
    deleted: string;
    openFile: string;
    loading: string;
    noChanges: string;
    diffUnavailable: string;
    binaryUnavailable: string;
    largeUnavailable: string;
    sensitiveUnavailable: string;
    truncatedUnavailable: string;
    symlinkUnavailable: string;
    truncatedSummary: string;
  };

  // Input Box
  inputBox: {
    placeholder: string;
    disclaimer: string;
    createSkillPrompt: string;
    addAttachments: string;
    referenceConversations: string;
    referenceConversationsSearch: string;
    referenceConversationsEmpty: string;
    referenceConversationsLimit: (max: number) => string;
    referenceConversationsRemove: (title: string) => string;
    referencedConversations: string;
    removeProjectAttachment: string;
    inputPolish: string;
    inputPolishing: string;
    inputPolishNoChanges: string;
    inputPolishFailed: string;
    inputPolishUndo: string;
    inputPolishCancel: string;
    voiceInputStartLabel: string;
    voiceInputStopLabel: string;
    voiceInputStart: string;
    voiceInputStop: string;
    voiceInputListening: string;
    voiceInputUnsupported: string;
    voiceInputPermissionDenied: string;
    voiceInputMicrophoneUnavailable: string;
    voiceInputUnsupportedLanguage: string;
    voiceInputNetworkError: string;
    voiceInputNoSpeech: string;
    voiceInputFailed: string;
    mode: string;
    flashMode: string;
    flashModeDescription: string;
    reasoningMode: string;
    reasoningModeDescription: string;
    proMode: string;
    proModeDescription: string;
    ultraMode: string;
    ultraModeDescription: string;
    reasoningEffort: string;
    reasoningEffortMinimal: string;
    reasoningEffortMinimalDescription: string;
    reasoningEffortLow: string;
    reasoningEffortLowDescription: string;
    reasoningEffortMedium: string;
    reasoningEffortMediumDescription: string;
    reasoningEffortHigh: string;
    reasoningEffortHighDescription: string;
    surpriseMe: string;
    surpriseMePrompt: string;
    followupLoading: string;
    followupConfirmTitle: string;
    followupConfirmDescription: string;
    followupConfirmAppend: string;
    followupConfirmReplace: string;
    suggestionPlaceholderRequired: string;
    goalCommandDescription: string;
    compactCommandDescription: string;
    goalLabel: string;
    goalContinuing: string;
    goalContinuationTooltip: string;
    goalSet: string;
    goalCleared: string;
    goalNone: string;
    goalActive: string;
    goalFailed: string;
    goalConflict: string;
    goalTooLong: string;
    goalReadPermissionRequired: string;
    goalWritePermissionRequired: string;
    goalLengthCounter: string;
    compactSuccess: string;
    compactSkipped: string;
    compactConflict: string;
    compactFailed: string;
    compactPermissionRequired: string;
    suggestions: {
      suggestion: string;
      prompt: string;
      icon: LucideIcon;
    }[];
    suggestionsCreate: (
      | {
          suggestion: string;
          prompt: string;
          icon: LucideIcon;
        }
      | {
          type: "separator";
        }
    )[];
    sendMessage: string;
    sendingMessage: string;
    stopStreaming: string;
    pleaseWaitStreaming: string;
    stopStreamingUnavailable: string;
    runPermissionRequired: string;
    threadPermissionRequired: string;
    uploadPermissionRequired: string;
  };

  // Sidebar
  sidebar: {
    recentChats: string;
    newChat: string;
    chats: string;
    expandSidebar: string;
    collapseSidebar: string;
    demoChats: string;
    agents: string;
    scheduledTasks: string;
    files: string;
    agentsDisabledTooltip: string;
    channels: string;
  };
  // Sidebar projects section
  projects: {
    title: string;
    newProject: string;
    namePlaceholder: string;
    moveToProject: string;
    moveToProjectHint: string;
    removeFromProject: string;
    archive: string;
    restore: string;
    deleteProject: string;
    deleteProjectConfirm: string;
    archived: string;
    empty: string;
    newChat: string;
    // Runtime states and actions
    create: string;
    createFailed: string;
    moveFailed: string;
    archiveFailed: string;
    restoreFailed: string;
    deleteFailed: string;
    switchToGrouped: string;
    switchToFlat: string;
    // Project page
    threads: string;
    threadsLoadFailed: string;
    untitled: string;
    settings: string;
    settingsSummary: string;
    projectDetailsTitle: string;
    projectDetailsDescription: string;
    lifecycleTitle: string;
    lifecycleDescription: string;
    notFound: string;
    loadFailed: string;
    refreshFailed: string;
    retry: string;
    retrying: string;
    projectUnavailable: string;
    // Project page — Documents / Instructions tabs (Phase 2)
    documents: string;
    documentsEmptyTitle: string;
    documentsEmptyHint: string;
    instructions: string;
    renameFailed: string;
    instructionsPlaceholder: string;
    instructionsByteCount: (used: number, max: number) => string;
    instructionsTooLong: (max: number) => string;
    instructionsSaved: string;
    instructionsSaveFailed: string;
    // Project page — Documents tab shelf (Phase 2 Slice E)
    documentsShelf: string;
    documentsShelfHint: string;
    uploadDocuments: string;
    uploadingDocuments: string;
    uploadDocumentFailed: string;
    documentFromThread: (threadName: string, kind: string) => string;
    documentKindUpload: string;
    documentKindOutput: string;
    attachToThread: string;
    attachDialogTitle: string;
    attachDialogHint: string;
    attachNoThreads: string;
    attachFailed: string;
    attachedToThread: (name: string) => string;
    moveDocumentToTrash: string;
    moveDocumentToTrashTitle: string;
    moveDocumentToTrashConfirm: (name: string, days: number) => string;
    deleteDocumentFailed: string;
    contentMissing: string;
    previewUnsupported: string;
    documentPreviewDialogHint: string;
    archivedDocumentsBanner: string;
    conversationFiles: string;
    conversationFilesEmpty: string;
    threadFilesTruncated: (count: number) => string;
    threadFilesBrowseInThread: string;
    saveToProject: string;
    saveToProjectDialogHint: string;
    saveToProjectFailed: string;
    savedToProject: (name: string) => string;
    shelfNameLabel: string;
    viewTrash: string;
    documentsLoadFailed: string;
    threadFilesLoadFailed: string;
    interimMemoryNotice: string;
  };

  // Trash view (Projects Phase 2)
  trash: {
    title: string;
    empty: string;
    loadFailed: string;
    retry: string;
    originProject: (projectName: string) => string;
    unknownProject: string;
    retentionLeft: (days: number) => string;
    restore: string;
    restoreFailed: string;
    restoredToast: (name: string) => string;
    restoreMergedToast: (name: string) => string;
    restoreConflict: string;
    restorePickProjectTitle: string;
    restorePickProjectHint: string;
    deletePermanently: string;
    deletePermanentlyTitle: string;
    deletePermanentlyConfirm: (name: string) => string;
    purgeFailed: string;
    emptyTrash: string;
    emptyTrashTitle: string;
    emptyTrashConfirm: (count: number) => string;
    emptyTrashFailed: string;
  };

  // Thread-scoped MCP background tasks
  backgroundTasks: {
    label: string;
    title: string;
    description: string;
    active: string;
    recent: string;
    empty: string;
    emptyHint: string;
    loadFailed: string;
    retry: string;
    cancel: string;
    cancelling: string;
    cancelFailed: string;
    cancellationRetrying: (attempt: number) => string;
    notificationRetrying: (attempt: number) => string;
    notificationStopped: string;
    trackingDegraded: string;
    viewDetails: string;
    hideDetails: string;
    detailsFailed: string;
    result: string;
    resultArtifact: string;
    inputRequired: string;
    inputUnavailable: string;
    lastPollError: string;
    created: (time: string) => string;
    updated: (time: string) => string;
    status: {
      submitted: string;
      working: string;
      inputRequired: string;
      completed: string;
      failed: string;
      cancelled: string;
    };
  };

  subagentBatches: {
    label: string;
    title: string;
    description: string;
    workerUnavailable: string;
    empty: string;
    emptyHint: string;
    loadFailed: string;
    active: string;
    recent: string;
    pause: string;
    resume: string;
    cancel: string;
    retryItem: string;
    exportResults: string;
    viewItems: string;
    hideItems: string;
    itemsFailed: string;
    controlFailed: string;
    retryFailed: string;
    progress: (completed: number, total: number) => string;
    limits: (live: number, running: number) => string;
    status: {
      queued: string;
      running: string;
      paused: string;
      completed: string;
      failed: string;
      cancelled: string;
    };
  };

  // Scheduled tasks
  scheduledTasks: {
    scheduleType: { cron: string; once: string; interval: string };
    preset: {
      label: string;
      hourly: string;
      daily: string;
      weekly: string;
      monthly: string;
      custom: string;
    };
    fields: {
      minute: string;
      time: string;
      weekday: string;
      dayOfMonth: string;
      cron: string;
      cronPlaceholder: string;
      runAt: string;
      timezone: string;
      intervalAmount: string;
      intervalUnit: string;
      intervalUnitSeconds: string;
      intervalUnitMinutes: string;
      intervalUnitHours: string;
      intervalMinHint: string;
    };
    weekdays: {
      mon: string;
      tue: string;
      wed: string;
      thu: string;
      fri: string;
      sat: string;
      sun: string;
    };
    preview: string;
    cronHelp: string;
    create: {
      title: string;
      taskTitle: string;
      prompt: string;
      agent: string;
      leadAgent: string;
      submit: string;
      success: string;
      fillRequired: string;
    };
    context: {
      fresh: string;
      reuse: string;
      threadIdPlaceholder: string;
      reuseNoticeTitle: string;
      reuseNoticeDescription: string;
    };
    filters: {
      statusLabel: string;
      allStatuses: string;
      enabled: string;
      paused: string;
      completed: string;
      failed: string;
      typeLabel: string;
      allTypes: string;
      cron: string;
      once: string;
      interval: string;
      clearFilters: string;
    };
    detail: {
      contextMode: string;
      agent: string;
      thread: string;
      lastThread: string;
      schedule: string;
      nextRun: string;
      lastRun: string;
      lastRunId: string;
      lastError: string;
      runsCount: string;
      runsCountOne: string;
      noRuns: string;
      noSelection: string;
      filteredByThread: string;
      loadFailed: string;
      refreshFailed: string;
      retry: string;
      retrying: string;
      loading: string;
      empty: string;
      noFilterResults: string;
    };
    actions: {
      edit: string;
      cancelEdit: string;
      pause: string;
      resume: string;
      trigger: string;
      duplicate: string;
      duplicateTitleSuffix: string;
      delete: string;
    };
    deleteConfirm: string;
    errors: {
      create: string;
      update: string;
      pause: string;
      resume: string;
      trigger: string;
      delete: string;
    };
    edit: {
      titlePlaceholder: string;
      promptPlaceholder: string;
      submit: string;
    };
    status: {
      enabled: string;
      paused: string;
      running: string;
      completed: string;
      failed: string;
      cancelled: string;
    };
    history: {
      navigation: string;
      newer: string;
      older: string;
      latest: string;
      page: string;
      paused: string;
      loading: string;
      loadFailed: string;
      retry: string;
    };
    runTrigger: { scheduled: string; manual: string };
    runStatus: {
      queued: string;
      launching: string;
      running: string;
      success: string;
      failed: string;
      skipped: string;
      interrupted: string;
    };
    recipes: {
      label: string;
      trending: { title: string; desc: string };
      news: { title: string; desc: string };
      issues: { title: string; desc: string };
      weekly: { title: string; desc: string };
    };
  };

  // Agents
  agents: {
    title: string;
    description: string;
    newAgent: string;
    emptyTitle: string;
    emptyDescription: string;
    loadFailed: string;
    loadFailedHint: string;
    detailLoading: string;
    detailNotFound: string;
    detailNotFoundHint: string;
    detailLoadFailed: string;
    detailLoadFailedHint: string;
    retry: string;
    retrying: string;
    featureDisabledTitle: string;
    featureDisabledDescription: string;
    featureCheckFailed: string;
    featureCheckFailedHint: string;
    permissionRequired: (permission: string) => string;
    permissionActionsLimited: (permissions: string) => string;
    chat: string;
    chatWith: (agentName: string) => string;
    delete: string;
    deleteFor: (agentName: string) => string;
    deleteConfirm: (agentName: string) => string;
    deleteSuccess: string;
    deleteFailed: string;
    newChat: string;
    createPageTitle: string;
    createPageSubtitle: string;
    nameStepTitle: string;
    nameStepHint: string;
    nameStepPlaceholder: string;
    nameStepContinue: string;
    nameStepInvalidError: string;
    nameStepAlreadyExistsError: string;
    nameStepNetworkError: string;
    nameStepCheckError: string;
    nameStepApiDisabledError: string;
    nameStepBootstrapMessage: string;
    nameStepBootstrapError: string;
    save: string;
    saving: string;
    saveRequested: string;
    saveFailed: string;
    saveNotCompleted: string;
    saveHint: string;
    saveCommandMessage: string;
    agentCreatedPendingRefresh: string;
    loadingCreatedAgent: string;
    more: string;
    agentCreated: string;
    startChatting: string;
    backToGallery: string;
    leaveCreationTitle: string;
    leaveCreationDescription: string;
    keepDesigning: string;
    leaveCreation: string;
    settings: string;
    settingsFor: (agentName: string) => string;
    settingsTitle: string;
    settingsDisplayName: string;
    settingsDisplayNameTooLong: string;
    settingsDisplayNameHint: string;
    settingsDescription: string;
    settingsUnsaved: string;
    settingsModel: string;
    settingsModelDefault: string;
    settingsCurrentModel: (name: string) => string;
    settingsModelLoadFailed: string;
    settingsModelRetry: string;
    settingsModelRetrying: string;
    settingsTemperature: string;
    settingsTemperatureHint: string;
    settingsMaxTokens: string;
    settingsMaxTokensPlaceholder: string;
    settingsThinking: string;
    settingsThinkingOn: string;
    settingsThinkingOff: string;
    settingsReasoningEffort: string;
    settingsInherit: string;
    settingsSaved: string;
    settingsSaveFailed: string;
    settingsInvalidTemperature: string;
    settingsInvalidMaxTokens: string;
  };

  // Breadcrumb
  breadcrumb: {
    workspace: string;
    chats: string;
  };

  // Workspace
  workspace: {
    officialWebsite: string;
    githubTooltip: string;
    settingsAndMore: string;
    visitGithub: string;
    reportIssue: string;
    contactUs: string;
    about: string;
    logout: string;
    gatewayUnavailable: string;
    gatewayUnavailableRetrying: string;
    gatewayRetry: string;
    gatewayRetrying: string;
    modelLoadFailed: string;
    modelLoadRetry: string;
    modelLoadRetrying: string;
  };

  // Conversation
  conversation: {
    noMessages: string;
    startConversation: string;
    branchCreated: string;
    branchFailed: string;
    streamFailed: string;
    streamRetrying: string;
    streamReplayGap: string;
    historyUnavailable: string;
    outlineLabel: string;
    outlineAttachmentFallback: string;
  };

  // Chats
  chats: {
    deleteChat: string;
    deleteConfirm: (title: string) => string;
    deleteFailed: string;
    noActiveChats: string;
    readPermissionRequired: string;
    writePermissionRequired: string;
    activeChats: string;
    archivedChats: string;
    archiveChat: string;
    restoreChat: string;
    archiveSuccess: string;
    restoreSuccess: string;
    archiveFailed: string;
    archiveDescription: string;
    undoArchive: string;
    noArchivedChats: string;
    noMatchingChats: string;
    loadChatsFailed: string;
    retryLoadChats: string;
    searchChats: string;
    branchLabel: (title: string, parentTitle: string) => string;
    loadMoreToSearch: string;
    loadingMore: string;
    loadOlderChats: string;
    pinChat: string;
    unpinChat: string;
    pinChatFailed: string;
  };

  // Sidecar
  sidecar: {
    title: string;
    open: string;
    close: string;
    delete: string;
    deleteConfirm: string;
    deleteSuccess: string;
    deleteFailed: string;
    addToConversation: string;
    askInSideChat: string;
    reference: string;
    selectedTextFragment: string;
    selectedTextFragments: string;
    clearReferences: string;
    emptyTitle: string;
    emptyDescription: string;
    placeholder: string;
    send: string;
    sendFailed: string;
    noContext: string;
    continuing: string;
    selectionCrossesMessages: string;
  };

  // Channels
  channels: {
    title: string;
    connect: string;
    modify: string;
    reconnect: string;
    disconnect: string;
    connected: string;
    notConnected: string;
    pending: string;
    revoked: string;
    disabled: string;
    unconfigured: string;
    unavailable: string;
    unavailableShort: string;
    readPermissionRequired: string;
    writePermissionRequired: string;
    adminPermissionRequired: string;
    runtimeConfigSaved: string;
    connectFailed: string;
    configureFailed: string;
    disconnectFailed: string;
    setupTitle: (name: string) => string;
    setupEditTitle: (name: string) => string;
    setupDescription: string;
    saveAndConnect: string;
    saveChanges: string;
    unsavedRuntimeConfig: string;
    descriptions: Record<string, string>;
    connectedAs: (name: string) => string;
  };

  // Page titles (document title)
  pages: {
    appName: string;
    chats: string;
    newChat: string;
    untitled: string;
  };

  // Tool calls
  toolCalls: {
    details: string;
    toolName: string;
    callId: string;
    input: string;
    result: string;
    error: string;
    noResult: string;
    emptyResult: string;
    truncated: string;
    moreSteps: (count: number) => string;
    lessSteps: string;
    executeCommand: string;
    presentFiles: string;
    needYourHelp: string;
    useTool: (toolName: string) => string;
    searchForRelatedInfo: string;
    searchForRelatedImages: string;
    searchFor: (query: string) => string;
    searchForRelatedImagesFor: (query: string) => string;
    searchOnWebFor: (query: string) => string;
    viewWebPage: string;
    listFolder: string;
    readFile: string;
    writeFile: string;
    clickToViewContent: string;
    writeTodos: string;
    skillInstallTooltip: string;
    browserNavigate: (url: string) => string;
    browserNavigateGeneric: string;
    browserClick: string;
    browserType: string;
    browserSnapshot: string;
    browserGetText: string;
    browserBack: string;
    browserScreenshot: string;
    browserClose: string;
  };

  humanInput: {
    answered: string;
    pending: string;
    readOnly: string;
    otherLabel: string;
    otherPlaceholder: string;
    submit: string;
    submitFailed: string;
    emptyError: string;
    requiredError: string;
    requiredA11yLabel: string;
    selectPlaceholder: string;
    answeredValue: (value: string) => string;
  };

  // Uploads
  uploads: {
    uploading: string;
    uploadingFiles: string;
    uploadFailed: string;
    limitsHint: (
      maxFiles: number,
      maxFileSize: string,
      maxTotalSize: string,
    ) => string;
    filesTooLarge: (files: string, maxFileSize: string) => string;
    tooManyFiles: (count: number, maxFiles: number) => string;
    totalSizeTooLarge: (count: number, maxTotalSize: string) => string;
  };

  // Subtasks
  subtasks: {
    subtask: string;
    historyUnavailable: string;
    executing: (count: number) => string;
    in_progress: string;
    completed: string;
    failed: string;
  };

  // Token Usage
  tokenUsage: {
    title: string;
    label: string;
    input: string;
    output: string;
    total: string;
    view: string;
    unavailable: string;
    unavailableShort: string;
    collecting: string;
    note: string;
    presets: {
      off: string;
      summary: string;
      perTurn: string;
      debug: string;
    };
    presetDescriptions: {
      off: string;
      summary: string;
      perTurn: string;
      debug: string;
    };
    finalAnswer: string;
    stepTotal: string;
    sharedAttribution: string;
    subagent: (description: string) => string;
    startTodo: (content: string) => string;
    completeTodo: (content: string) => string;
    updateTodo: (content: string) => string;
    removeTodo: (content: string) => string;
  };

  contextUsage: {
    label: string;
    title: string;
    badgeAriaLabel: (percentage: string) => string;
  };

  // Shortcuts
  shortcuts: {
    searchActions: string;
    noResults: string;
    actions: string;
    keyboardShortcuts: string;
    keyboardShortcutsDescription: string;
    openCommandPalette: string;
    toggleSidebar: string;
  };

  // Settings
  settings: {
    title: string;
    description: string;
    loading: string;
    unsavedChangesTitle: string;
    unsavedChangesDescription: string;
    keepEditing: string;
    discardChanges: string;
    sections: {
      account: string;
      appearance: string;
      product: string;
      administration: string;
      channels: string;
      memory: string;
      subagents: string;
      notification: string;
      about: string;
    };
    productPreferences: {
      title: string;
      description: string;
      loading: string;
      loadError: string;
      extensionMissing: string;
      densityLabel: string;
      comfortable: string;
      compact: string;
      save: string;
      saving: string;
      unsaved: string;
      saved: string;
      saveError: string;
      dataTitle: string;
      dataDescription: string;
      dataScopeNote: string;
      dataScopeDetails: string;
      dataExportActionsTitle: string;
      dataDeletionActionsTitle: string;
      dataDeletionActionsDescription: string;
      capabilityLoading: string;
      capabilityError: string;
      capabilityRetry: string;
      capabilityUnsupported: string;
      capabilityChanged: string;
      capabilityStaticMode: string;
      capabilitySignedOut: string;
      dataAccountScopeNote: string;
      dataThreadsScopeNote: string;
      dataProjectsScopeNote: string;
      dataScheduledTasksScopeNote: string;
      dataAgentsScopeNote: string;
      dataMemoryScopeNote: string;
      dataFilesScopeNote: string;
      dataNotEnabled: string;
      dataLoading: string;
      dataLoadError: string;
      dataActiveCheckFailed: string;
      dataRetry: string;
      dataPendingExport: string;
      dataPendingDeletion: string;
      dataSubmissionUnconfirmed: string;
      dataCheckSubmission: string;
      dataRecoveryUnavailable: string;
      dataJobsLabel: string;
      dataJobsPagination: string;
      dataJobsPrevious: string;
      dataJobsNext: string;
      dataJobsPage: string;
      dataEmpty: string;
      dataPageEmpty: string;
      dataExport: string;
      dataAccountExport: string;
      dataThreadsExport: string;
      dataProjectsExport: string;
      dataScheduledTasksExport: string;
      dataAgentsExport: string;
      dataMemoryExport: string;
      dataFilesExport: string;
      dataDelete: string;
      dataDeleteThreads: string;
      dataDeleteScheduledTasks: string;
      dataDeleteAgents: string;
      dataDeleteProjects: string;
      dataDeleteMemory: string;
      dataDeleteFiles: string;
      dataSubmitting: string;
      dataOperationError: string;
      dataDownload: string;
      dataDownloadZip: string;
      dataDownloading: string;
      dataDownloadError: string;
      dataExpired: string;
      dataCancelJob: string;
      dataRetryExport: string;
      dataCancelling: string;
      dataTaskFailureReasons: {
        temporary: string;
        authorizationUnavailable: string;
        authorizationDenied: string;
        scopeUnavailable: string;
        sizeLimit: string;
        unsupported: string;
        invalidData: string;
        integrity: string;
        unknown: string;
      };
      dataDeleteDialogTitle: string;
      dataDeleteDialogDescription: string;
      dataDeleteThreadsDialogTitle: string;
      dataDeleteThreadsDialogDescription: string;
      dataDeleteThreadsPhraseLabel: string;
      dataDeleteThreadsConfirm: string;
      dataDeleteThreadsCancel: string;
      dataDeletePhraseLabel: string;
      dataDeleteConfirm: string;
      dataDeleteCancel: string;
      dataDeleteScheduledTasksDialogTitle: string;
      dataDeleteScheduledTasksDialogDescription: string;
      dataDeleteScheduledTasksPhraseLabel: string;
      dataDeleteScheduledTasksConfirm: string;
      dataDeleteScheduledTasksCancel: string;
      dataDeleteAgentsDialogTitle: string;
      dataDeleteAgentsDialogDescription: string;
      dataDeleteAgentsPhraseLabel: string;
      dataDeleteAgentsConfirm: string;
      dataDeleteAgentsCancel: string;
      dataDeleteProjectsDialogTitle: string;
      dataDeleteProjectsDialogDescription: string;
      dataDeleteProjectsPhraseLabel: string;
      dataDeleteProjectsConfirm: string;
      dataDeleteProjectsCancel: string;
      dataDeleteMemoryDialogTitle: string;
      dataDeleteMemoryDialogDescription: string;
      dataDeleteMemoryPhraseLabel: string;
      dataDeleteMemoryConfirm: string;
      dataDeleteMemoryCancel: string;
      dataDeleteFilesDialogTitle: string;
      dataDeleteFilesDialogDescription: string;
      dataDeleteFilesPhraseLabel: string;
      dataDeleteFilesConfirm: string;
      dataDeleteFilesCancel: string;
      dataProgressLabel: string;
      dataExportJob: string;
      dataAccountExportJob: string;
      dataThreadsExportJob: string;
      dataProjectsExportJob: string;
      dataScheduledTasksExportJob: string;
      dataAgentsExportJob: string;
      dataMemoryExportJob: string;
      dataFilesExportJob: string;
      dataPartialBadge: string;
      dataPartialResultNote: string;
      dataAccountExportPartialResultNote: string;
      dataProjectsPartialResultNote: string;
      dataScheduledTasksPartialResultNote: string;
      dataAgentsPartialResultNote: string;
      dataMemoryPartialResultNote: string;
      dataFilesPartialResultNote: string;
      dataPartialDeletionBadge: string;
      dataDeleteJob: string;
      dataDeleteThreadsJob: string;
      dataDeleteScheduledTasksJob: string;
      dataDeleteAgentsJob: string;
      dataDeleteProjectsJob: string;
      dataDeleteMemoryJob: string;
      dataDeleteFilesJob: string;
      dataDeleteMemoryCompleted: string;
      dataDeletedFilesCount: string;
      dataDeleteFilesPartialCount: string;
      dataDeletedCount: string;
      dataDeletedThreadsCount: string;
      dataDeleteThreadsPartialCount: string;
      dataDeletedScheduledTasksCount: string;
      dataDeleteScheduledTasksPartialCount: string;
      dataDeletedAgentsCount: string;
      dataDeleteAgentsPartialCount: string;
      dataDeletedProjectsCount: string;
      dataDeleteProjectsCompleted: string;
      status: {
        queued: string;
        running: string;
        retry_wait: string;
        completed: string;
        failed: string;
        cancelled: string;
      };
      stage: {
        queued: string;
        inventory: string;
        deleting: string;
        history: string;
        packaging: string;
        finalizing: string;
        other: string;
      };
    };
    productAdmin: {
      accountsTitle: string;
      accountsDescription: string;
      accountsLoading: string;
      accountsLoadError: string;
      refreshFailed: string;
      accountsEmpty: string;
      accountEmail: string;
      accountRole: string;
      accountStatus: string;
      accountCreated: string;
      accountSetup: string;
      accountActions: string;
      accountAdmin: string;
      accountMember: string;
      accountActive: string;
      accountDisabled: string;
      accountReady: string;
      accountNeedsSetup: string;
      disableAccount: string;
      enableAccount: string;
      disableAccountFor: (email: string) => string;
      enableAccountFor: (email: string) => string;
      confirmAccountStatus: string;
      confirmDisableDescription: string;
      confirmEnableDescription: string;
      cancel: string;
      confirm: string;
      updatingAccount: string;
      accountUpdateError: string;
      accountStatusConflict: string;
      accountRunStopSummary: string;
      accountsNewer: string;
      accountsOlder: string;
      accountCount: string;
      configTitle: string;
      configDescription: string;
      configLoadError: string;
      englishName: string;
      chineseName: string;
      featureTitle: string;
      features: {
        overview: string;
        chats: string;
        agents: string;
        scheduled_tasks: string;
        capabilities: string;
        files: string;
        data_privacy: string;
        administration: string;
      };
      featureUnavailable: string;
      privacyNote: string;
      unimplementedFeaturesNote: string;
      save: string;
      saving: string;
      unsaved: string;
      saved: string;
      saveError: string;
      version: string;
      versionConflict: string;
      reload: string;
      title: string;
      description: string;
      loading: string;
      loadError: string;
      retry: string;
      empty: string;
      time: string;
      actor: string;
      action: string;
      resource: string;
      result: string;
      auditActions: {
        preferenceSaved: string;
        preferenceDeleted: string;
        productDisplayUpdated: string;
        accountEnabled: string;
        accountDisabled: string;
        dataExportRequested: string;
        dataDeletionRequested: string;
        dataExportCompleted: string;
        dataDeletionCompleted: string;
        dataJobCancelRequested: string;
        dataJobCancelled: string;
        dataJobFailed: string;
        dataExportDownloadRequested: string;
        threadCreated: string;
        threadBranched: string;
        threadUpdated: string;
        threadMoved: string;
        threadDeleted: string;
        uploadCreated: string;
        uploadDeleted: string;
        projectDocumentTrashed: string;
        projectDocumentRestored: string;
        projectDocumentPurged: string;
        projectTrashEmptied: string;
        projectCreated: string;
        projectUpdated: string;
        projectArchived: string;
        projectRestored: string;
        projectDeleted: string;
        scheduledTaskCreated: string;
        scheduledTaskUpdated: string;
        scheduledTaskPaused: string;
        scheduledTaskResumed: string;
        scheduledTaskTriggered: string;
        scheduledTaskDeleted: string;
        memoryCleared: string;
        memoryExported: string;
        memoryImported: string;
        memoryFactCreated: string;
        memoryFactUpdated: string;
        memoryFactDeleted: string;
        customAgentCreated: string;
        customAgentUpdated: string;
        customAgentDeleted: string;
        skillInstalled: string;
        skillUpdated: string;
        skillDeleted: string;
        skillRolledBack: string;
        skillEnabled: string;
        skillDisabled: string;
        skillsReloaded: string;
        userProfileUpdated: string;
        patCreated: string;
        patRevoked: string;
        passwordChanged: string;
        accountRegistered: string;
        adminInitialized: string;
        oidcAccountProvisioned: string;
        oidcLoginSucceeded: string;
        other: string;
      };
      auditResources: {
        userSetting: string;
        productConfiguration: string;
        account: string;
        dataJob: string;
        thread: string;
        threadUpload: string;
        projectDocument: string;
        projectTrash: string;
        project: string;
        scheduledTask: string;
        memory: string;
        memoryFact: string;
        customAgent: string;
        skill: string;
        userProfile: string;
        personalAccessToken: string;
        other: string;
      };
      auditOutcomes: {
        success: string;
        notFound: string;
        failure: string;
        cancelled: string;
        other: string;
      };
      requestId: string;
      newer: string;
      older: string;
    };
    memory: {
      title: string;
      description: string;
      loadFailed: string;
      refreshFailed: string;
      retry: string;
      retrying: string;
      empty: string;
      rawJson: string;
      exportButton: string;
      exportFailed: string;
      exportSuccess: string;
      importButton: string;
      importFailed: string;
      importConfirmTitle: string;
      importConfirmDescription: string;
      importFileLabel: string;
      importInvalidFile: string;
      importSuccess: string;
      manualFactSource: string;
      addFact: string;
      addFactTitle: string;
      editFactTitle: string;
      addFactSuccess: string;
      editFactSuccess: string;
      clearAll: string;
      clearAllFailed: string;
      clearAllConfirmTitle: string;
      clearAllConfirmDescription: string;
      clearAllSuccess: string;
      factDeleteConfirmTitle: string;
      factDeleteConfirmDescription: string;
      factDeleteSuccess: string;
      factDeleteFailed: string;
      factContentLabel: string;
      factCategoryLabel: string;
      factConfidenceLabel: string;
      factContentPlaceholder: string;
      factCategoryPlaceholder: string;
      factConfidenceHint: string;
      factSave: string;
      factSaveFailed: string;
      factValidationContent: string;
      factValidationConfidence: string;
      noFacts: string;
      summaryReadOnly: string;
      memoryFullyEmpty: string;
      factPreviewLabel: string;
      searchPlaceholder: string;
      filterAll: string;
      filterFacts: string;
      filterSummaries: string;
      noMatches: string;
      markdown: {
        overview: string;
        userContext: string;
        work: string;
        personal: string;
        topOfMind: string;
        historyBackground: string;
        recentMonths: string;
        earlierContext: string;
        longTermBackground: string;
        updatedAt: string;
        facts: string;
        empty: string;
        table: {
          category: string;
          confidence: string;
          confidenceLevel: {
            veryHigh: string;
            high: string;
            normal: string;
            unknown: string;
          };
          content: string;
          source: string;
          createdAt: string;
          view: string;
        };
      };
    };
    appearance: {
      themeTitle: string;
      themeDescription: string;
      system: string;
      light: string;
      dark: string;
      systemDescription: string;
      lightDescription: string;
      darkDescription: string;
      languageTitle: string;
      languageDescription: string;
    };
    tools: {
      adminRequired: string;
      loadFailed: string;
      empty: string;
      addServer: string;
      addServerDescription: string;
      addServerPlaceholder: string;
      serverDefinitionLabel: string;
      definitionEmpty: string;
      definitionInvalidJson: string;
      definitionRootNotObject: string;
      definitionNoServers: string;
      definitionServerNotObject: string;
      editServer: string;
      editServerDescription: string;
      editSingleServer: string;
      editServerNameMismatch: string;
      serverAlreadyExists: string;
      removeServer: string;
      removeServerDescription: string;
      unnamedServer: string;
      enableFailed: string;
      addFailed: string;
      updateFailed: string;
      deleteFailed: string;
    };
    subagents: {
      title: string;
      description: string;
      executionNote: string;
      adminNote: string;
      create: string;
      createFailed: string;
      loadFailed: string;
      refreshFailed: string;
      retry: string;
      retrying: string;
      empty: string;
      sourceBuiltin: string;
      sourceConfig: string;
      sourceManaged: string;
      conflict: string;
      overridden: string;
      createTitle: string;
      editTitle: string;
      name: string;
      nameHint: string;
      displayName: string;
      descriptionLabel: string;
      systemPrompt: string;
      model: string;
      inheritModel: string;
      tools: string;
      skills: string;
      listModeAll: string;
      listModeNone: string;
      listModeSelected: string;
      listNamesPlaceholder: string;
      maxTurns: string;
      timeout: string;
      created: string;
      saved: string;
      unsaved: string;
      updateFailed: string;
      deleted: string;
      deleteFailed: string;
      deleteTitle: string;
      deleteConfirm: string;
      bindingTitle: string;
      bindingDescription: string;
      allAllowed: string;
      noneAllowed: string;
      selectedAllowed: string;
      missing: string;
    };
    channels: {
      title: string;
      description: string;
      disabled: string;
      loadFailed: string;
      refreshFailed: string;
      retry: string;
      retrying: string;
    };
    integrations: {
      title: string;
      description: string;
      refresh: string;
      install: string;
      reinstall: string;
      installing: string;
      ready: string;
      pending: string;
      available: string;
      unavailable: string;
      connected: string;
      loadFailed: string;
      adminRequired: string;
      permissionRequired: string;
      lark: {
        title: string;
        description: string;
        skillPack: string;
        gatewayCli: string;
        auth: string;
        sandboxRuntime: string;
        sandboxRuntimeInitContainer: string;
        sandboxRuntimeBroker: string;
        sandboxRuntimeGatewayDownload: string;
        sandboxRuntimeNotReady: string;
        notInstalled: string;
        skillsInstalled: (installed: number, expected: number) => string;
        installedVersion: (version: string) => string;
        updateAvailable: (version: string) => string;
        runtimeVersionMismatch: string;
        authNotConfigured: string;
        authConfigured: string;
        authConfiguredFor: (user: string) => string;
        statusLoadFailed: string;
        installFailed: string;
        connectionFailed: string;
        authorizationFailed: string;
        authorizationSuperseded: string;
        authorizationCheckEnded: string;
        restartConnection: string;
        connect: string;
        authStarting: string;
        checkingConnection: string;
        connectedAction: string;
        requestPermissions: string;
        alreadyConnected: string;
        changeAppButton: string;
        changeAppTitle: string;
        changeAppDescription: string;
        changeAppIdLabel: string;
        changeAppSecretLabel: string;
        changeAppAuthResetNote: string;
        changeAppSubmit: string;
        changeAppReRegister: string;
        changeAppSwitched: string;
        changeAppFailed: string;
        brandFeishu: string;
        brandLark: string;
        connectionStarted: string;
        connectionReady: string;
        authStarted: string;
        authorizationStillPending: string;
        permissionTitle: string;
        permissionDescription: string;
        authDomains: Record<
          | "approval"
          | "apps"
          | "attendance"
          | "base"
          | "calendar"
          | "contact"
          | "docs"
          | "drive"
          | "event"
          | "im"
          | "mail"
          | "markdown"
          | "mindnotes"
          | "minutes"
          | "note"
          | "okr"
          | "sheets"
          | "slides"
          | "task"
          | "vc"
          | "wiki"
          | "all",
          { label: string; description: string }
        >;
        customScopeLabel: string;
        customScopePlaceholder: string;
        customScopeDescription: string;
        openConnectionLinkTitle: string;
        openConnectionLinkDescription: string;
        openAuthLinkTitle: string;
        openAuthLinkDescription: string;
        waitingAuthTitle: string;
        waitingAuthDescription: string;
        openAuthLink: string;
        copyAuthLink: string;
        completeAuth: string;
        continueAuth: string;
        preparingAuthorization: string;
        completingAuth: string;
        authExpiresIn: (seconds: number) => string;
        installingTitle: string;
        installingDescription: string;
        installNextTitle: string;
        installNextDescription: string;
        cliNextTitle: string;
        cliNextDescription: string;
        configuredTitle: string;
        configuredDescription: string;
        connectedTitle: string;
        connectedDescription: string;
        authNextTitle: string;
        authNextDescription: string;
      };
    };
    skills: {
      exportPrevious: string;
      exportNotices: Record<string, string>;
      exportSkill: string;
      exportTitle: string;
      exportDescription: string;
      exportLoading: string;
      exportFiles: string;
      exportDirectories: string;
      exportSize: string;
      exportContents: string;
      exportMore: string;
      exportRequirements: string;
      exportCompatibility: string;
      exportTools: string;
      exportSecrets: string;
      exportOptional: string;
      exportRequired: string;
      exportUndeclared: string;
      exportScope: string;
      exportWarnings: string;
      exportWarningDescription: string;
      exportBlocked: string;
      exportDownload: string;
      exportDownloading: string;
      exportHandedOff: string;
      exportChanged: string;
      exportRefresh: string;
      exportFailed: string;
      exportBusy: string;
      exportTimeout: string;
      exportLimit: string;
      exportNotFound: string;
      createSkill: string;
      emptyTitle: string;
      emptyDescription: string;
      emptyButton: string;
      adminRequired: string;
      installAdminRequired: string;
      loadFailed: string;
      refreshFailed: string;
      retry: string;
      retrying: string;
      enableFailed: string;
      installFromFile: string;
      installingArchive: string;
      invalidArchive: string;
      archiveTooLarge: string;
      installFailed: string;
      installBlocked: string;
    };
    notification: {
      title: string;
      description: string;
      requestPermission: string;
      deniedHint: string;
      testButton: string;
      testTitle: string;
      testBody: string;
      notSupported: string;
      disableNotification: string;
    };
    account: {
      profileTitle: string;
      email: string;
      role: string;
      changePasswordTitle: string;
      changePasswordDescription: string;
      ssoProvider: string;
      ssoPasswordDescription: string;
      ssoPasswordMessage: string;
      currentPassword: string;
      newPassword: string;
      confirmNewPassword: string;
      passwordMismatch: string;
      passwordTooShort: string;
      passwordChangedSuccess: string;
      networkError: string;
      updating: string;
      updatePassword: string;
      unsavedPasswordChanges: string;
      exportDataTitle: string;
      exportDataDescription: string;
      exportDataButton: string;
      exportingData: string;
      cancelDataExport: string;
      cancellingDataExport: string;
      exportDataCancelled: string;
      exportStageInventory: string;
      exportStageHistory: string;
      exportStageFiles: string;
      exportStagePackage: string;
      exportDataPartial: string;
      exportDataError: string;
      signOut: string;
    };
    acknowledge: {
      emptyTitle: string;
      emptyDescription: string;
    };
  };

  // Login / Auth
  login: {
    heroKicker: string;
    heroTitle: string;
    heroDescription: string;
    heroFeatures: [string, string, string];
    heroFooter: string;
    signInTitle: string;
    createAccountTitle: string;
    email: string;
    emailPlaceholder: string;
    password: string;
    passwordPlaceholder: string;
    showPassword: string;
    hidePassword: string;
    rememberMe: string;
    rememberMeDescription: string;
    pleaseWait: string;
    signIn: string;
    createAccount: string;
    createAdminAccount: string;
    adminSetupRequiredTitle: string;
    adminSetupRequiredDescription: string;
    orContinueWith: string;
    ssoHint: string;
    continueWith: (provider: string) => string;
    noAccountSignUp: string;
    haveAccountSignIn: string;
    backToHome: string;
    networkError: string;
    serviceUnavailableTitle: string;
    serviceUnavailableDescription: string;
    retry: string;
    authFailed: string;
    errors: {
      sso_failed: string;
      sso_cancelled: string;
      sso_account_exists: string;
      sso_not_allowed: string;
    };
  };
  setup: {
    loading: string;
    adminTitle: string;
    adminDescription: string;
    emailPlaceholder: string;
    adminPasswordPlaceholder: string;
    confirmPassword: string;
    confirmPasswordPlaceholder: string;
    setupTitle: string;
    setupDescription: string;
    currentPassword: string;
    currentPasswordPlaceholder: string;
    newPassword: string;
    newPasswordPlaceholder: string;
    confirmNewPassword: string;
    confirmNewPasswordPlaceholder: string;
    creatingAdmin: string;
    savingPassword: string;
    completeSetup: string;
  };
}
