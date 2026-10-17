import {
  CompassIcon,
  GraduationCapIcon,
  ImageIcon,
  MicroscopeIcon,
  PenLineIcon,
  ShapesIcon,
  SparklesIcon,
  VideoIcon,
} from "lucide-react";

import type { Translations } from "./types";

export const enUS: Translations = {
  // Locale meta
  locale: {
    localName: "English",
  },

  capabilities: {
    integrationSkills: "From plugins",
    sharedSkills: "Shared skills",
    title: "Capability Center",
    description: "Add tools and skills that fit the way your team works.",
    plugins: "Plugins",
    skills: "Skills",
    searchPlugins: "Search plugins by name or purpose",
    searchSkills: "Search skills by name or purpose",
    allPlugins: "All plugins",
    installed: "Installed",
    enabled: "Enabled",
    disabled: "Disabled",
    configure: "Configure",
    details: "View details",
    addPlugin: "Add MCP plugin",
    builtin: "Built-in",
    community: "Community",
    custom: "My skills",
    allSkills: "All skills",
    availablePlugins: "Available plugins",
    availableSkills: "Available skills",
    pluginHint:
      "Connect your everyday apps so your agent can access information and get work done.",
    skillHint:
      "Turn useful methods into skills, ready to use in any conversation.",
    noResults: "No matches found",
    larkName: "Lark / Feishu",
    larkDescription:
      "Work with documents, messages, calendars, and multidimensional tables in your conversations.",
    larkTag: "Collaboration",
    larkStatusUnavailable: "Integration status is temporarily unavailable.",
    retryIntegrationStatus: "Retry",
    connect: "Connect",
    notInstalled: "Not installed",
    mcpDescription: "Let your agent use the tools provided by this plugin.",
    mcpLabel: "MCP plugin",
    pluginSettings: "Plugin settings",
    communityTitle: "Bring a skill from the community",
    communityDescription:
      "Import a .skill file to manage and use it under My skills.",
    skillEnabled: "Enable skill",
    manage: "Manage",
  },

  // Common
  common: {
    home: "Home",
    settings: "Settings",
    delete: "Delete",
    edit: "Edit",
    rename: "Rename",
    renameFailed: "Failed to rename thread.",
    share: "Share",
    openInNewWindow: "Open in new window",
    close: "Close",
    more: "More",
    search: "Search",
    loadMore: "Load more",
    showingOf: (loaded, total) => `Showing ${loaded} of ${total}`,
    download: "Download",
    thinking: "Thinking",
    artifacts: "Artifacts",
    public: "Public",
    custom: "Custom",
    notAvailableInDemoMode: "Not available in demo mode",
    loading: "Loading...",
    error: "Error:",
    version: "Version",
    lastUpdated: "Last updated",
    code: "Code",
    preview: "Preview",
    cancel: "Cancel",
    save: "Save",
    install: "Install",
    create: "Create",
    import: "Import",
    export: "Export",
    exportAsMarkdown: "Export as Markdown",
    exportAsJSON: "Export as JSON",
    exportSuccess: "Conversation exported",
    exportFailed: "Failed to export conversation.",
    regenerate: "Regenerate",
    editAndRerun: "Edit and rerun",
    editMessageContent: "Message text to edit",
    updateAndRerun: "Update and rerun",
    editRerunWarning:
      "Rerunning restores conversation state only. Files, memory, and external actions are not undone.",
    branch: "Branch conversation",
    showArtifacts: "Show artifacts of this conversation",
    browser: "Browser",
    showBrowser: "Open browser panel",
  },

  browserView: {
    browser: "Browser",
    back: "Back",
    forward: "Forward",
    urlLabel: "Browser URL",
    urlPlaceholder: "Enter a URL and press Enter",
    stopLiveControl: "Stop live control",
    takeLiveControl: "Take live control",
    live: "Live",
    connecting: "Connecting…",
    close: "Close browser panel",
    screenshotAlt: "Browser view",
    connectingTitle: "Connecting to live browser…",
    noActivityTitle: "No browser activity yet",
    waitingFirstFrame: "Waiting for the first live frame.",
    emptyDescription:
      "Enter a URL above or let the agent browse — the live view will appear here.",
    cannotOpen: (url) => (url ? `Cannot open ${url}` : "Cannot open that URL"),
    navigationNoScreenshot: "Navigated, but no screenshot could be captured.",
  },

  runDuration: {
    reasoning: "Reasoning",
    working: "Working…",
    completedIn: (duration) => `Completed in ${duration}`,
    description:
      "Total task time, including model reasoning, tool calls, and waiting.",
    lessThanSecond: "<1s",
    hours: (value) => `${value}h`,
    minutes: (value) => `${value}m`,
    seconds: (value) => `${value}s`,
    separator: " ",
  },

  messageFeedback: {
    groupLabel: "Rate the assistant response",
    positive: "Mark this response as helpful",
    negative: "Mark this response as unhelpful",
    removePositive: "Remove helpful feedback",
    removeNegative: "Remove unhelpful feedback",
    removePermissionRequired:
      "You need threads:delete permission to remove saved feedback.",
  },

  // Home
  home: {
    docs: "Docs",
    blog: "Blog",
  },

  // Welcome
  welcome: {
    workspaceLabel: "AI workspace",
    greeting: "What would you like to work on today?",
    description:
      "Bring a question, a complex task, or a rough idea. Your workspace can research, analyze, and turn it into something useful.",

    createYourOwnSkill: "Create Your Own Skill",
    createYourOwnSkillDescription:
      "Create reusable skills that give your workspace the tools and context to handle your team's work.",
  },

  // Clipboard
  clipboard: {
    copyToClipboard: "Copy to clipboard",
    copiedToClipboard: "Copied to clipboard",
    failedToCopyToClipboard: "Failed to copy to clipboard",
    linkCopied: "Link copied to clipboard",
  },

  artifactEditing: {
    unsaved: "Unsaved",
    saving: "Saving...",
    saved: "Artifact saved",
    exit: "Exit editing",
    discard: "Discard changes",
    discardChanges: "Discard the unsaved changes to this artifact?",
    conflict:
      "This artifact changed after you started editing. Discard your draft and reload before saving.",
    conflictShort: "Changed remotely",
    runInProgress: "Wait for the current agent run to finish before saving.",
    saveFailed: "Failed to save artifact",
  },

  artifactPreview: {
    limited: (previewSize, totalSize) =>
      totalSize
        ? `Showing the first ${previewSize} of ${totalSize}.`
        : `Showing the first ${previewSize}.`,
    loadFullFile: "Load full file",
    loadingFullFile: "Loading full file...",
    previewFailed:
      "This file could not be previewed. You can still download it.",
    viewSource: "View source",
    selectFileLabel: "Select an artifact file",
    missingTarget: "This link does not say which artifact to display.",
  },

  artifactTable: {
    title: "Table preview",
    header: "First row as header",
    column: (index) => `Column ${index}`,
    total: (count) => `${count} rows`,
    sample: (count) => `Preview of first ${count} rows`,
    range: (start, end, limited) =>
      `${start}–${end}${limited ? " of preview" : ""}`,
    columnsLimited: "Showing the first 50 columns of the preview.",
    uneven:
      "Some rows have different numbers of fields. Missing fields are marked.",
    empty: "This file is empty.",
    incomplete:
      "No complete records fit in this preview. View the source or download the file.",
    failed:
      "Unable to preview this table reliably. View the source or download the file.",
    retry: "Retry preview",
    previous: "Previous page",
    next: "Next page",
    cell: (row, column) => `View cell: row ${row}, column ${column}`,
    cellValue: "Cell value",
    missing: "Missing",
    savedVersion:
      "Opens or downloads the saved file. Your draft has not been saved.",
  },

  artifactArchive: {
    downloadCurrent: (count) =>
      `Download current versions (${count} ${count === 1 ? "file" : "files"})`,
    currentVersionNotice:
      "The file list comes from this response. Contents are the current versions and may have changed.",
    downloadFailed: "Failed to download artifact archive.",
    runUnavailable:
      "These artifacts are no longer available. Refresh the conversation and try again.",
    runNotReady:
      "The artifacts are not ready or have changed. Wait for the run to finish, then try again.",
    archiveTooLarge:
      "The archive exceeds the file count or size limit. Choose fewer or smaller files.",
    archiveBusy: "Artifact archives are busy right now. Try again shortly.",
  },

  modelPicker: {
    title: "Choose a model",
    favorites: "Favorites",
    otherModels: "Other models",
    noModels: "No models available",
    favoriteModel: (displayName, name) => `Favorite ${displayName} (${name})`,
    sessionOnly: "Favorites are stored for this session only.",
  },

  // Citations
  citations: {
    sourcesSummary: (count) =>
      `Used ${count} ${count === 1 ? "source" : "sources"}`,
    citeCount: (count) => `${count} ${count === 1 ? "cite" : "cites"}`,
    copyReference: (title) => `Copy ${title} reference`,
    copiedReference: (title) => `Copied ${title} reference`,
  },

  // Workspace Changes
  workspaceChanges: {
    title: "Workspace changes",
    editedTitle: (count) => `Edited ${count} ${count === 1 ? "file" : "files"}`,
    badge: (count, additions, deletions) =>
      `${count} ${count === 1 ? "file" : "files"} changed +${additions} -${deletions}`,
    viewChanges: "View changes",
    created: "Created",
    modified: "Modified",
    deleted: "Deleted",
    openFile: "Open file",
    loading: "Loading workspace changes...",
    noChanges: "No workspace changes recorded.",
    diffUnavailable: "Diff unavailable",
    binaryUnavailable: "Binary file. Diff unavailable.",
    largeUnavailable: "Large file. Diff omitted.",
    sensitiveUnavailable: "Sensitive path. Content hidden.",
    truncatedUnavailable: "Diff omitted because the change set is too large.",
    symlinkUnavailable: "Symlink change. Diff unavailable.",
    truncatedSummary: "Some changes were truncated.",
  },

  // Input Box
  inputBox: {
    placeholder: "How can I assist you today?",
    disclaimer: "AI can make mistakes",
    createSkillPrompt:
      "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
    addAttachments: "Add attachments",
    referenceConversations: "Reference a conversation",
    referenceConversationsSearch: "Search conversations",
    referenceConversationsEmpty: "No conversations found",
    referenceConversationsLimit: (max: number) =>
      `Up to ${max} conversations per message`,
    referenceConversationsRemove: (title: string) =>
      `Remove reference to ${title}`,
    referencedConversations: "Referenced conversations",
    removeProjectAttachment: "Remove attached document",
    inputPolish: "Polish input",
    inputPolishing: "Polishing input...",
    inputPolishNoChanges: "This input is already clear.",
    inputPolishFailed:
      "Could not polish the draft. Your original text is unchanged; please retry.",
    inputPolishUndo: "Undo polish",
    inputPolishCancel: "Cancel polishing",
    voiceInputStartLabel: "Dictate with voice",
    voiceInputStopLabel: "Stop voice input",
    voiceInputStart:
      "Dictate with voice. This app receives only transcribed text; audio is handled by your browser or system speech service.",
    voiceInputStop: "Stop voice input",
    voiceInputListening: "Listening... Click to stop voice input.",
    voiceInputUnsupported:
      "Voice input is not supported in this browser. Try Chrome or Edge.",
    voiceInputPermissionDenied:
      "Microphone access was denied. Allow microphone access and try again.",
    voiceInputMicrophoneUnavailable:
      "No microphone was detected. Check your device input and try again.",
    voiceInputUnsupportedLanguage:
      "Voice input does not support the current language in this browser.",
    voiceInputNetworkError:
      "Voice input could not reach the browser speech service.",
    voiceInputNoSpeech: "No speech was detected. Please try again.",
    voiceInputFailed: "Voice input failed. Please try again.",
    mode: "Mode",
    flashMode: "Flash",
    flashModeDescription: "Fast and efficient, but may not be accurate",
    reasoningMode: "Reasoning",
    reasoningModeDescription:
      "Reasoning before action, balance between time and accuracy",
    proMode: "Pro",
    proModeDescription:
      "Reasoning, planning and executing, get more accurate results, may take more time",
    ultraMode: "Ultra",
    ultraModeDescription:
      "Pro mode with subagents to divide work; best for complex multi-step tasks",
    reasoningEffort: "Reasoning Effort",
    reasoningEffortMinimal: "Minimal",
    reasoningEffortMinimalDescription: "Retrieval + Direct Output",
    reasoningEffortLow: "Low",
    reasoningEffortLowDescription: "Simple Logic Check + Shallow Deduction",
    reasoningEffortMedium: "Medium",
    reasoningEffortMediumDescription:
      "Multi-layer Logic Analysis + Basic Verification",
    reasoningEffortHigh: "High",
    reasoningEffortHighDescription:
      "Full-dimensional Logic Deduction + Multi-path Verification + Backward Check",
    surpriseMe: "Surprise",
    surpriseMePrompt: "Surprise me",
    followupLoading: "Generating follow-up questions...",
    followupConfirmTitle: "Send suggestion?",
    followupConfirmDescription:
      "You already have text in the input. Choose how to send it.",
    followupConfirmAppend: "Append & send",
    followupConfirmReplace: "Replace & send",
    suggestionPlaceholderRequired:
      "Replace the suggestion placeholder before sending.",
    goalCommandDescription: "Set, show, or clear an active goal",
    compactCommandDescription:
      "Compact earlier context while keeping the full chat visible",
    goalLabel: "Goal",
    goalContinuing: "Continuing {count}/{max}",
    goalContinuationTooltip:
      "Auto-continued {count}/{max} times toward the goal; stops at the limit.",
    goalSet: "Goal set.",
    goalCleared: "Goal cleared.",
    goalNone: "No active goal.",
    goalActive: "Active goal: {goal}",
    goalFailed: "Could not update the conversation goal. Please try again.",
    goalConflict:
      "A run is active in this conversation. Wait until it finishes before changing the goal.",
    goalTooLong: "Goal is too long. Keep it under {max} characters.",
    goalReadPermissionRequired:
      "You do not have permission to view this conversation's goal. Ask your administrator for threads:read.",
    goalWritePermissionRequired:
      "You do not have permission to change this conversation's goal. Ask your administrator for threads:write.",
    goalLengthCounter: "Goal length: {length}/{max} characters",
    compactSuccess:
      "Earlier context compacted. The full chat remains visible; future model calls will use the summary and recent messages.",
    compactSkipped: "The current context does not need compaction yet.",
    compactConflict:
      "Context cannot be compacted right now. Wait for active work to finish, or ask your administrator whether compaction is enabled.",
    compactFailed: "Could not compact context. Please try again.",
    compactPermissionRequired:
      "You do not have permission to compact this conversation. Ask your administrator for threads:write.",
    suggestions: [
      {
        suggestion: "Write",
        prompt: "Write a blog post about the latest trends on [topic]",
        icon: PenLineIcon,
      },
      {
        suggestion: "Research",
        prompt:
          "Conduct a deep dive research on [topic], and summarize the findings.",
        icon: MicroscopeIcon,
      },
      {
        suggestion: "Collect",
        prompt: "Collect data from [source] and create a report.",
        icon: ShapesIcon,
      },
      {
        suggestion: "Learn",
        prompt: "Learn about [topic] and create a tutorial.",
        icon: GraduationCapIcon,
      },
    ],
    suggestionsCreate: [
      {
        suggestion: "Webpage",
        prompt: "Create a webpage about [topic]",
        icon: CompassIcon,
      },
      {
        suggestion: "Image",
        prompt: "Create an image about [topic]",
        icon: ImageIcon,
      },
      {
        suggestion: "Video",
        prompt: "Create a video about [topic]",
        icon: VideoIcon,
      },
      {
        type: "separator",
      },
      {
        suggestion: "Skill",
        prompt:
          "We're going to build a new skill step by step with `skill-creator`. To start, what do you want this skill to do?",
        icon: SparklesIcon,
      },
    ],
    sendMessage: "Send message",
    sendingMessage: "Sending message",
    stopStreaming: "Stop generating",
    pleaseWaitStreaming: "Please wait for the current response to finish.",
    stopStreamingUnavailable:
      "Stopping the running turn is not permitted for your role.",
    runPermissionRequired:
      "You do not have permission to start an Agent run. Ask your administrator for runs:create.",
    threadPermissionRequired:
      "You do not have permission to add this conversation to a project. Ask your administrator for threads:write.",
    uploadPermissionRequired:
      "You do not have permission to upload files to this conversation. Ask your administrator for threads:write.",
  },

  // Sidebar
  sidebar: {
    newChat: "New chat",
    chats: "Chats",
    expandSidebar: "Expand sidebar",
    collapseSidebar: "Collapse sidebar",
    channels: "Channels",
    recentChats: "Recent chats",
    demoChats: "Demo chats",
    agents: "Agents",
    scheduledTasks: "Scheduled tasks",
    files: "Files",
    agentsDisabledTooltip:
      "The Gateway has not exposed the custom-agent management API. Ask an administrator to check agents_api.enabled.",
  },
  // Sidebar projects section
  projects: {
    title: "Projects",
    newProject: "New project",
    namePlaceholder: "Project name",
    moveToProject: "Move to project",
    moveToProjectHint:
      "Moving a chat doesn't remove the content already in it.",
    removeFromProject: "Remove from project",
    archive: "Archive",
    restore: "Restore",
    deleteProject: "Delete project",
    deleteProjectConfirm:
      "Deleting this project unlinks its chats; chats, their history, and their files are not deleted. Shelf documents move to trash and stay recoverable for the retention window.",
    archived: "Archived",
    empty: "No chats in this project yet.",
    newChat: "New chat",
    create: "Create",
    createFailed: "Failed to create project",
    moveFailed: "Failed to move chat",
    archiveFailed: "Failed to archive project",
    restoreFailed: "Failed to restore project",
    deleteFailed: "Failed to delete project",
    switchToGrouped: "Group chats by project",
    switchToFlat: "Show flat chat list",
    threads: "Chats",
    threadsLoadFailed: "Couldn't load project chats",
    untitled: "Untitled",
    settings: "Settings",
    settingsSummary: "Manage this project's name and availability.",
    projectDetailsTitle: "Project details",
    projectDetailsDescription:
      "Choose a name that makes this project easy to find.",
    lifecycleTitle: "Project availability",
    lifecycleDescription:
      "Archive a project to hide it from active lists. You can restore it whenever you need it again.",
    notFound: "Project not found or deleted.",
    loadFailed: "Project could not be loaded.",
    refreshFailed:
      "Refresh failed. Showing the last successfully loaded project.",
    retry: "Retry loading",
    retrying: "Retrying…",
    projectUnavailable:
      "Couldn't link the chat to the project. Your message was not sent — try again.",
    documents: "Documents",
    documentsEmptyTitle: "No documents yet",
    documentsEmptyHint:
      "Upload files or save conversation files to build this project's shelf.",
    instructions: "Instructions",
    renameFailed: "Failed to rename project",
    instructionsPlaceholder:
      "Background, goals, and conventions the agent should always know for this project…",
    instructionsByteCount: (used, max) => `${used} / ${max} bytes`,
    instructionsTooLong: (max) =>
      `Instructions are over the ${max}-byte limit. Shorten them to save.`,
    instructionsSaved: "Saved",
    instructionsSaveFailed: "Failed to save instructions",
    documentsShelf: "Shelf",
    documentsShelfHint: "Drop files here to add them to the shelf",
    uploadDocuments: "Upload",
    uploadingDocuments: "Uploading…",
    uploadDocumentFailed: "Failed to upload document",
    documentFromThread: (threadName, kind) => `from ${threadName} · ${kind}`,
    documentKindUpload: "upload",
    documentKindOutput: "output",
    attachToThread: "Attach to chat",
    attachDialogTitle: "Attach to chat",
    attachDialogHint: "Choose a chat to attach this document to.",
    attachNoThreads: "No chats available.",
    attachFailed: "Failed to attach document",
    attachedToThread: (name) => `Attached "${name}"`,
    moveDocumentToTrash: "Move to trash",
    moveDocumentToTrashTitle: "Move to trash?",
    moveDocumentToTrashConfirm: (name, days) =>
      `"${name}" will move to the trash and stay recoverable for ${days} days.`,
    deleteDocumentFailed: "Failed to move document to trash",
    contentMissing: "Content missing",
    previewUnsupported:
      "This file type can't be previewed in the browser. Download it to view it.",
    documentPreviewDialogHint:
      "Preview this project document. Large files may show only a preview; download to view the full file.",
    archivedDocumentsBanner:
      "This project is archived. Documents are read-only — upload, save to project, and trash are unavailable.",
    conversationFiles: "Conversation files",
    conversationFilesEmpty: "No files in this project's chats yet.",
    threadFilesTruncated: (count) =>
      `Only the first ${count} files of this chat are shown.`,
    threadFilesBrowseInThread: "Browse all files in the chat",
    saveToProject: "Save to project",
    saveToProjectDialogHint:
      "Choose the name this conversation file will use on the project shelf.",
    saveToProjectFailed: "Failed to save file to project",
    savedToProject: (name) => `Saved "${name}" to the shelf`,
    shelfNameLabel: "Shelf name",
    viewTrash: "Trash",
    documentsLoadFailed: "Couldn't load project documents",
    threadFilesLoadFailed: "Couldn't load conversation files",
    interimMemoryNotice:
      "Memory stays global for now: anything discussed in a project may enter your global memory until per-project memory arrives in Phase 3.",
  },

  trash: {
    title: "Trash",
    empty: "Trash is empty.",
    loadFailed: "Couldn't load trash",
    retry: "Try again",
    originProject: (projectName) => `from ${projectName}`,
    unknownProject: "Unknown project",
    retentionLeft: (days) =>
      days <= 0
        ? "Less than a day left"
        : days === 1
          ? "1 day left"
          : `${days} days left`,
    restore: "Restore",
    restoreFailed: "Failed to restore document",
    restoredToast: (name) => `Restored "${name}"`,
    restoreMergedToast: (name) =>
      `"${name}" matched existing shelf content — merged.`,
    restoreConflict:
      "This document's content is missing or damaged, so it stays in the trash.",
    restorePickProjectTitle: "Choose a project",
    restorePickProjectHint:
      "The original project is gone or archived. Pick an active project to restore into.",
    deletePermanently: "Delete permanently",
    deletePermanentlyTitle: "Delete permanently?",
    deletePermanentlyConfirm: (name) =>
      `"${name}" will be permanently deleted. This cannot be undone.`,
    purgeFailed: "Failed to delete document",
    emptyTrash: "Empty trash",
    emptyTrashTitle: "Empty trash?",
    emptyTrashConfirm: (count) =>
      count === 1
        ? "1 document will be permanently deleted. This cannot be undone."
        : `${count} documents will be permanently deleted. This cannot be undone.`,
    emptyTrashFailed: "Failed to empty trash",
  },

  backgroundTasks: {
    label: "Background tasks",
    title: "Background tasks",
    description: "Long-running MCP work for this chat.",
    active: "Active",
    recent: "Recent",
    empty: "No background tasks yet",
    emptyHint: "Long-running MCP tasks started in this chat will appear here.",
    loadFailed: "Couldn't load background tasks",
    retry: "Try again",
    cancel: "Cancel task",
    cancelling: "Cancelling…",
    cancelFailed: "Failed to cancel task",
    cancellationRetrying: (attempt) =>
      `Cancellation attempt ${attempt} failed; the app will keep retrying.`,
    notificationRetrying: (attempt) =>
      `Chat notification attempt ${attempt} failed; the app will retry with backoff.`,
    notificationStopped:
      "Chat notification delivery stopped after repeated or permanent failures.",
    trackingDegraded: "Status checks are delayed; the app is still retrying.",
    viewDetails: "View details",
    hideDetails: "Hide details",
    detailsFailed: "Couldn't load task details",
    result: "Result",
    resultArtifact: "Result artifact",
    inputRequired: "Input required",
    inputUnavailable:
      "This integration cannot send your response back to the remote task yet.",
    lastPollError: "Latest status error",
    created: (time) => `Started ${time}`,
    updated: (time) => `Updated ${time}`,
    status: {
      submitted: "Submitted",
      working: "Working",
      inputRequired: "Input needed",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    },
  },

  subagentBatches: {
    label: "Batches",
    title: "Subagent batches",
    description: "Durable, restart-safe work for many independent items.",
    workerUnavailable:
      "The batch worker is not running. Historical batches remain available in read-only mode.",
    empty: "No subagent batches yet",
    emptyHint: "Explicit batch_task submissions in this chat will appear here.",
    loadFailed: "Couldn't load subagent batches",
    active: "Active",
    recent: "Recent",
    pause: "Pause",
    resume: "Resume",
    cancel: "Cancel",
    retryItem: "Retry",
    exportResults: "Export JSONL",
    viewItems: "View items",
    hideItems: "Hide items",
    itemsFailed: "Couldn't load batch items",
    controlFailed: "Failed to update subagent batch",
    retryFailed: "Failed to retry batch item",
    progress: (completed, total) => `${completed} of ${total} terminal`,
    limits: (live, running) => `Live ${live} · running ${running}`,
    status: {
      queued: "Queued",
      running: "Running",
      paused: "Paused",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    },
  },

  // Scheduled tasks
  scheduledTasks: {
    scheduleType: {
      cron: "Recurring",
      once: "One-time",
      interval: "Interval",
    },
    preset: {
      label: "Repeat",
      hourly: "Hourly",
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly",
      custom: "Custom cron",
    },
    fields: {
      minute: "Minute",
      time: "Time",
      weekday: "On",
      dayOfMonth: "Day of month",
      cron: "Cron expression",
      cronPlaceholder: "0 9 * * *",
      runAt: "Run at",
      timezone: "Timezone",
      intervalAmount: "Every",
      intervalUnit: "Interval unit",
      intervalUnitSeconds: "seconds",
      intervalUnitMinutes: "minutes",
      intervalUnitHours: "hours",
      intervalMinHint: "Minimum 60 seconds (the default server floor).",
    },
    weekdays: {
      mon: "Mon",
      tue: "Tue",
      wed: "Wed",
      thu: "Thu",
      fri: "Fri",
      sat: "Sat",
      sun: "Sun",
    },
    preview: "Preview",
    cronHelp: "Open crontab.guru",
    create: {
      title: "Create scheduled task",
      taskTitle: "Task title",
      prompt: "Prompt",
      agent: "Agent",
      leadAgent: "Default agent (lead_agent)",
      submit: "Create",
      success: "Scheduled task created",
      fillRequired: "Fill all required fields",
    },
    context: {
      fresh: "Fresh thread",
      reuse: "Reuse thread",
      threadIdPlaceholder: "Thread ID",
      reuseNoticeTitle: "Uses this thread's conversation history",
      reuseNoticeDescription:
        "If this thread has an active run at the scheduled time, the scheduler queues this occurrence and starts it when the thread is available. It fails if the configured queue wait limit is exceeded.",
    },
    filters: {
      statusLabel: "Status",
      allStatuses: "All statuses",
      enabled: "Enabled",
      paused: "Paused",
      completed: "Completed",
      failed: "Failed",
      typeLabel: "Type",
      allTypes: "All types",
      cron: "Cron",
      once: "Once",
      interval: "Interval",
      clearFilters: "Clear filters",
    },
    detail: {
      contextMode: "Context mode",
      agent: "Agent",
      thread: "Thread",
      lastThread: "Last thread",
      schedule: "Schedule",
      nextRun: "Next run",
      lastRun: "Last run",
      lastRunId: "Last run id",
      lastError: "Last error",
      runsCount: "{count} runs",
      runsCountOne: "{count} run",
      noRuns: "No runs yet",
      noSelection: "No scheduled task selected",
      filteredByThread: "Filtered by thread: {id}",
      loadFailed: "Could not load scheduled tasks.",
      refreshFailed:
        "Refresh failed. Showing the last successfully loaded tasks.",
      retry: "Try again",
      retrying: "Retrying…",
      loading: "Loading scheduled tasks…",
      empty: "No scheduled tasks yet. Create one to see it here.",
      noFilterResults: "No scheduled tasks match these filters.",
    },
    actions: {
      edit: "Edit",
      cancelEdit: "Cancel edit",
      pause: "Pause",
      resume: "Resume",
      trigger: "Trigger now",
      duplicate: "Duplicate",
      duplicateTitleSuffix: " (Copy)",
      delete: "Delete",
    },
    deleteConfirm:
      "Are you sure you want to delete this scheduled task? This action cannot be undone.",
    errors: {
      create: "Failed to create scheduled task",
      update: "Failed to update scheduled task",
      pause: "Failed to pause scheduled task",
      resume: "Failed to resume scheduled task",
      trigger: "Failed to trigger scheduled task",
      delete: "Failed to delete scheduled task",
    },
    edit: {
      titlePlaceholder: "Edit title",
      promptPlaceholder: "Edit prompt",
      submit: "Save edit",
      dirtyTitle: "Discard unsaved edits?",
      dirtyDescription:
        "This task has unsaved edits. Continuing will discard them.",
      discard: "Discard changes",
      continueEditing: "Keep editing",
    },
    status: {
      enabled: "Enabled",
      paused: "Paused",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    },
    history: {
      navigation: "Run history pages",
      newer: "Newer runs",
      older: "Older runs",
      latest: "Latest runs",
      page: "Page {page}",
      paused:
        "Automatic refresh is paused on older pages. Return to latest for current runs.",
      loading: "Loading runs…",
      loadFailed: "Could not load run history.",
      retry: "Retry history",
    },
    runTrigger: { scheduled: "scheduled", manual: "manual" },
    runStatus: {
      queued: "Queued",
      launching: "Launching",
      running: "Running",
      success: "Success",
      failed: "Failed",
      skipped: "Skipped",
      interrupted: "Interrupted",
    },
    recipes: {
      label: "Quick create",
      trending: {
        title: "GitHub Trending daily",
        desc: "Summarize today's top 10 trending repos",
      },
      news: {
        title: "Daily tech news digest",
        desc: "Collect and summarize the day's top tech news",
      },
      issues: {
        title: "GitHub Issue triage",
        desc: "Triage a repo's open issues (fill in {{repo}})",
      },
      weekly: {
        title: "Weekly report",
        desc: "Compile a weekly summary, every Monday",
      },
    },
  },

  // Agents
  agents: {
    title: "Agents",
    description:
      "Create and manage custom agents with specialized prompts and capabilities.",
    newAgent: "New Agent",
    emptyTitle: "No custom agents yet",
    emptyDescription:
      "Create your first custom agent with a specialized system prompt.",
    loadFailed: "Could not load custom agents.",
    loadFailedHint:
      "Check the Gateway connection, then retry. This does not mean your agents were deleted.",
    detailLoading: "Loading agent…",
    detailNotFound: "Agent not found",
    detailNotFoundHint:
      "It may have been deleted, or your account may not have access. Check the agent gallery, then try again.",
    detailLoadFailed: "Could not open this agent",
    detailLoadFailedHint:
      "Check the Gateway connection or your account access, then retry.",
    retry: "Retry",
    retrying: "Retrying...",
    featureDisabledTitle: "Agents feature is not enabled",
    featureDisabledDescription:
      "This feature is not enabled on this server. Please contact your administrator.",
    featureCheckFailed: "Could not check agent availability",
    featureCheckFailedHint:
      "The workspace could not reach the Gateway. Check the connection and retry; this does not mean agents are disabled.",
    permissionRequired: (permission) =>
      `Your account needs this permission: ${permission}`,
    permissionActionsLimited: (permissions) =>
      `Some agent actions are unavailable because these permissions are missing: ${permissions}`,
    chat: "Chat",
    chatWith: (agentName) => `Chat with ${agentName}`,
    delete: "Delete",
    deleteFor: (agentName) => `Delete agent ${agentName}`,
    deleteConfirm: (agentName) =>
      `Are you sure you want to delete “${agentName}”? This cannot be undone and will also remove its configuration, SOUL.md, and associated memory files.`,
    deleteSuccess: "Agent deleted",
    deleteFailed: "Failed to delete agent",
    newChat: "New chat",
    createPageTitle: "Design your Agent",
    createPageSubtitle:
      "Describe the agent you want — I'll help you create it through conversation.",
    nameStepTitle: "Name your new Agent",
    nameStepHint:
      "Letters, digits, and hyphens only — stored lowercase (e.g. code-reviewer)",
    nameStepPlaceholder: "e.g. code-reviewer",
    nameStepContinue: "Continue",
    nameStepInvalidError:
      "Invalid name — use only letters, digits, and hyphens",
    nameStepAlreadyExistsError: "An agent with this name already exists",
    nameStepNetworkError:
      "Network request failed — check your network or backend connection",
    nameStepCheckError: "Could not verify name availability — please try again",
    nameStepApiDisabledError:
      "Custom agent management is not enabled on this server. Please contact your administrator.",
    nameStepBootstrapMessage:
      "The new custom agent name is {name}. Help me design its purpose, behavior, and SOUL.md before saving it.",
    nameStepBootstrapError:
      "Could not start agent setup. Check the backend or model connection and retry. Your name is preserved.",
    save: "Save agent",
    saving: "Saving agent...",
    saveRequested:
      "Save requested. The workspace is generating and saving an initial version now.",
    saveFailed: "Failed to save agent. Please try again.",
    saveNotCompleted:
      "The agent was not saved because this run did not perform the save action. Please try again.",
    saveHint:
      "You can save this agent at any time from the top-right menu, even if this is only a first draft.",
    saveCommandMessage:
      "Please save this custom agent now based on everything we have discussed so far. Treat this as my explicit confirmation to save. If some details are still missing, make reasonable assumptions, generate a concise first SOUL.md in English, and call setup_agent immediately without asking me for more confirmation.",
    agentCreatedPendingRefresh:
      "The agent was saved, but its details are temporarily unavailable. Retry here or check the agent gallery.",
    loadingCreatedAgent: "Loading the saved agent…",
    more: "More actions",
    agentCreated: "Agent created!",
    startChatting: "Start chatting",
    backToGallery: "Back to Gallery",
    leaveCreationTitle: "Discard this agent design?",
    leaveCreationDescription:
      "The current name or design conversation has not been saved. This temporary work cannot be recovered after you leave.",
    keepDesigning: "Keep designing",
    leaveCreation: "Discard and leave",
    settings: "Agent settings",
    settingsFor: (agentName) => `Agent settings for ${agentName}`,
    settingsTitle: "Agent settings",
    settingsDisplayName: "Display name",
    settingsDisplayNameTooLong:
      "Display name must be at most 100 Unicode code points.",
    settingsDisplayNameHint:
      "Supports Unicode. Leave blank to use the agent identifier",
    settingsDescription:
      "Choose a display name and model defaults for this agent. Model changes take effect on the next message.",
    settingsUnsaved: "The agent settings have unsaved changes.",
    settingsModel: "Default model",
    settingsModelDefault: "Use global default",
    settingsCurrentModel: (name) => `Currently saved: ${name}`,
    settingsModelLoadFailed:
      "The model catalog is temporarily unavailable. The saved model will be preserved, or you can switch to the global default.",
    settingsModelRetry: "Retry model catalog",
    settingsModelRetrying: "Retrying…",
    settingsTemperature: "Temperature",
    settingsTemperatureHint: "0 = deterministic, higher = more creative (0–2).",
    settingsMaxTokens: "Max output tokens",
    settingsMaxTokensPlaceholder: "Inherit from model",
    settingsThinking: "Thinking mode",
    settingsThinkingOn: "On",
    settingsThinkingOff: "Off",
    settingsReasoningEffort: "Reasoning effort",
    settingsInherit: "Inherit",
    settingsSaved: "Agent settings saved",
    settingsSaveFailed: "Failed to save agent settings",
    settingsInvalidTemperature: "Temperature must be between 0 and 2",
    settingsInvalidMaxTokens:
      "Max output tokens must be a positive integer up to 200,000",
  },

  // Breadcrumb
  breadcrumb: {
    workspace: "Workspace",
    chats: "Chats",
  },

  // Workspace
  workspace: {
    officialWebsite: "Product website",
    githubTooltip: "Project repository",
    settingsAndMore: "Settings and more",
    visitGithub: "Project repository",
    reportIssue: "Report an issue",
    contactUs: "Contact us",
    about: "About this product",
    logout: "Log out",
    gatewayUnavailable: "Gateway is temporarily unavailable.",
    gatewayUnavailableRetrying: "Retrying in the background…",
    gatewayRetry: "Retry now",
    gatewayRetrying: "Retrying…",
    modelLoadFailed:
      "Models couldn't be loaded. Model selection and token usage may be unavailable.",
    modelLoadRetry: "Retry",
    modelLoadRetrying: "Retrying…",
  },

  // Conversation
  conversation: {
    noMessages: "No messages yet",
    startConversation: "Start a conversation to see messages here",
    branchCreated: "Conversation branch created",
    branchFailed: "Failed to branch conversation.",
    streamFailed: "The conversation could not be completed. Please try again.",
    streamRetrying: "The service is temporarily busy. Retrying…",
    streamReplayGap:
      "Some live updates expired. The conversation was restored from saved state.",
    historyUnavailable:
      "Full conversation history requires runs:read. Current live messages may still appear.",
    outlineLabel: "Conversation outline",
    outlineAttachmentFallback: "Image or file message",
  },

  // Chats
  chats: {
    deleteChat: "Delete chat",
    deleteConfirm: (title) =>
      `Delete “${title}”? This will delete the conversation and its files. This action cannot be undone.`,
    deleteFailed: "Failed to delete chat. Please try again.",
    noActiveChats: "No recent chats",
    readPermissionRequired:
      "You do not have permission to view conversations. Ask your administrator for threads:read.",
    writePermissionRequired:
      "You do not have permission to update conversations. Ask your administrator for threads:write.",
    activeChats: "Recent chats",
    archivedChats: "Archived",
    archiveChat: "Archive chat",
    restoreChat: "Restore chat",
    archiveSuccess: "Chat archived",
    restoreSuccess: "Chat restored",
    archiveFailed: "Failed to update archived chat",
    archiveDescription:
      "Archiving keeps messages and files. Running and scheduled tasks continue.",
    undoArchive: "Undo",
    noArchivedChats: "No archived chats",
    noMatchingChats: "No matching chats in the loaded conversations",
    loadChatsFailed: "Failed to load conversations",
    retryLoadChats: "Retry",
    searchChats: "Search chats",
    branchLabel: (title, parentTitle) => `${title}, branch of ${parentTitle}`,
    loadMoreToSearch: "Load more to search older conversations",
    loadingMore: "Loading more...",
    loadOlderChats: "Load older chats",
    pinChat: "Pin chat",
    unpinChat: "Unpin chat",
    pinChatFailed: "Failed to update pinned chat",
  },

  // Sidecar
  sidecar: {
    title: "Side chat",
    open: "Open side chat",
    close: "Close side chat",
    delete: "Delete side chat",
    deleteConfirm:
      "Are you sure you want to delete this side chat? This action cannot be undone. To simply hide it, use the side chat toggle in the header instead.",
    deleteSuccess: "Side chat deleted",
    deleteFailed: "Failed to delete side chat.",
    addToConversation: "Add to conversation",
    askInSideChat: "Ask in side chat",
    reference: "Reference",
    selectedTextFragment: "{count} selected text fragment",
    selectedTextFragments: "{count} selected text fragments",
    clearReferences: "Clear selected references",
    emptyTitle: "Ask a follow-up",
    emptyDescription: "Ask a follow-up grounded in the referenced text.",
    placeholder: "Ask a deeper follow-up...",
    send: "Send",
    sendFailed: "Failed to send side chat message.",
    threadWritePermissionRequired:
      "Creating a side chat requires thread write permission.",
    noContext: "No context selected",
    continuing: "Continue in this side chat",
    selectionCrossesMessages:
      "Selection spans multiple messages. Select text within a single reply to quote it.",
  },

  // Channels
  channels: {
    title: "Channels",
    connect: "Connect",
    modify: "Modify",
    reconnect: "Reconnect",
    disconnect: "Disconnect",
    connected: "Connected",
    notConnected: "Not connected",
    pending: "Pending",
    revoked: "Disconnected",
    disabled: "Disabled",
    unconfigured: "Not configured",
    unavailable: "Channel connections are unavailable right now.",
    unavailableShort: "Unavailable",
    readPermissionRequired:
      "You do not have permission to view channel connections. Ask your administrator for channels:read.",
    writePermissionRequired:
      "You do not have permission to connect a channel. Ask your administrator for channels:write.",
    adminPermissionRequired:
      "A system administrator with channels:admin permission is required to manage runtime credentials.",
    runtimeConfigSaved:
      "Channel settings were saved. You do not have permission to start the connection.",
    connectFailed:
      "Could not start the channel connection. Check its setup and try again.",
    configureFailed:
      "Could not save channel settings. Check the values and try again.",
    disconnectFailed: "Could not disconnect the channel. Please try again.",
    setupTitle: (name: string) => `Connect ${name}`,
    setupEditTitle: (name: string) => `Modify ${name}`,
    setupDescription:
      "Enter the values needed by this server process. They are not written to config.yaml.",
    saveAndConnect: "Save and connect",
    saveChanges: "Save changes",
    unsavedRuntimeConfig: "The channel credentials have unsaved changes.",
    descriptions: {
      buzz: "Buzz channels and direct messages through your configured agent.",
      telegram: "Telegram direct messages through your configured bot.",
      slack: "Slack workspace messages and mentions.",
      discord: "Discord server messages through your configured bot.",
      feishu: "Feishu and Lark messages through your configured app.",
      dingtalk: "DingTalk Stream Push messages through your configured bot.",
      wechat: "WeChat iLink messages through your configured bot.",
      wecom: "WeCom messages through your configured AI bot.",
    },
    connectedAs: (name: string) => `Connected as ${name}.`,
  },

  // Page titles (document title)
  pages: {
    appName: "Flow Desk",
    chats: "Chats",
    newChat: "New chat",
    untitled: "Untitled",
  },

  // Tool calls
  toolCalls: {
    details: "Tool details",
    toolName: "Tool name",
    callId: "Call ID",
    input: "Input",
    result: "Result",
    error: "Error",
    noResult: "No result received",
    emptyResult: "Empty result",
    truncated:
      "Preview truncated; copying includes only the displayed preview.",
    moreSteps: (count: number) => `${count} more step${count === 1 ? "" : "s"}`,
    lessSteps: "Less steps",
    executeCommand: "Execute command",
    presentFiles: "Present files",
    needYourHelp: "Need your help",
    useTool: (toolName: string) => `Use "${toolName}" tool`,
    searchFor: (query: string) => `Search for "${query}"`,
    searchForRelatedInfo: "Search for related information",
    searchForRelatedImages: "Search for related images",
    searchForRelatedImagesFor: (query: string) =>
      `Search for related images for "${query}"`,
    searchOnWebFor: (query: string) => `Search on the web for "${query}"`,
    viewWebPage: "View web page",
    listFolder: "List folder",
    readFile: "Read file",
    writeFile: "Write file",
    clickToViewContent: "Click to view file content",
    writeTodos: "Update to-do list",
    skillInstallTooltip:
      "Install a skill and make it available in this workspace",
    browserNavigate: (url: string) => `Open ${url} in browser`,
    browserNavigateGeneric: "Open page in browser",
    browserClick: "Click element in browser",
    browserType: "Type into browser field",
    browserSnapshot: "Read page in browser",
    browserGetText: "Read page text in browser",
    browserBack: "Go back in browser",
    browserScreenshot: "Capture browser screenshot",
    browserClose: "Close browser",
  },

  humanInput: {
    answered: "Answered",
    pending: "Sending...",
    readOnly: "Read only",
    otherLabel: "Other answer",
    otherPlaceholder: "Type another answer...",
    submit: "Submit",
    submitFailed: "Your answer could not be submitted. Please try again.",
    emptyError: "Enter an answer before submitting.",
    requiredError: "Fill in all required fields before submitting.",
    requiredA11yLabel: "required",
    selectPlaceholder: "Select...",
    answeredValue: (value: string) => `Answered: ${value}`,
  },

  // Subtasks
  uploads: {
    uploading: "Uploading...",
    uploadingFiles: "Uploading files, please wait...",
    uploadFailed: "Files could not be uploaded. Please try again.",
    limitsHint: (maxFiles: number, maxFileSize: string, maxTotalSize: string) =>
      `Add attachments (up to ${maxFiles} files, ${maxFileSize} each, ${maxTotalSize} total). Most regular file types are supported; compress macOS .app bundles first.`,
    filesTooLarge: (files: string, maxFileSize: string) =>
      `Files exceeding the ${maxFileSize} per-file limit were not added: ${files}.`,
    tooManyFiles: (count: number, maxFiles: number) =>
      `${count} file${count === 1 ? " was" : "s were"} not added. You can attach up to ${maxFiles} files at once.`,
    totalSizeTooLarge: (count: number, maxTotalSize: string) =>
      `${count} file${count === 1 ? " was" : "s were"} not added. Attachments can total up to ${maxTotalSize}.`,
  },

  subtasks: {
    subtask: "Subtask",
    historyUnavailable:
      "Run history is unavailable without runs:read permission.",
    executing: (count: number) =>
      `Executing ${count === 1 ? "" : count + " "}subtask${count === 1 ? "" : "s in parallel"}`,
    in_progress: "Running subtask",
    completed: "Subtask completed",
    failed: "Subtask failed",
  },

  // Token Usage
  tokenUsage: {
    title: "Token Usage",
    label: "Tokens",
    input: "Input",
    output: "Output",
    total: "Total",
    view: "Display",
    unavailable:
      "No token usage yet. Usage appears only after a successful model response when the provider returns usage_metadata.",
    unavailableShort: "No usage returned",
    collecting: "Collecting tokens",
    note: "Header totals use persisted thread usage, plus visible in-flight usage while a run is still streaming. Per-turn and debug usage come from currently visible messages only. Totals may differ from provider billing pages.",
    presets: {
      off: "Off",
      summary: "Summary",
      perTurn: "Per turn",
      debug: "Debug",
    },
    presetDescriptions: {
      off: "Hide token usage in the header and conversation.",
      summary: "Show only the current conversation total in the header.",
      perTurn:
        "Show the header total and one token summary per assistant turn.",
      debug: "Show the header total and step-level token debugging details.",
    },
    finalAnswer: "Final answer",
    stepTotal: "Step total",
    sharedAttribution: "Shared across multiple actions in this step",
    subagent: (description: string) => `Subagent: ${description}`,
    startTodo: (content: string) => `Start To-do: ${content}`,
    completeTodo: (content: string) => `Complete To-do: ${content}`,
    updateTodo: (content: string) => `Update To-do: ${content}`,
    removeTodo: (content: string) => `Remove To-do: ${content}`,
  },

  contextUsage: {
    label: "Context",
    title: "Context window",
    badgeAriaLabel: (percentage: string) =>
      `Context window ${percentage}% full`,
  },

  // Shortcuts
  shortcuts: {
    searchActions: "Search actions...",
    noResults: "No results found.",
    actions: "Actions",
    keyboardShortcuts: "Keyboard Shortcuts",
    keyboardShortcutsDescription:
      "Navigate the workspace faster with keyboard shortcuts.",
    openCommandPalette: "Open Command Palette",
    toggleSidebar: "Toggle Sidebar",
  },

  // Settings
  settings: {
    title: "Settings",
    description: "Adjust how the workspace looks and behaves for you.",
    loading: "Loading settings…",
    unsavedChangesTitle: "Discard unsaved changes?",
    unsavedChangesDescription:
      "These settings have not been saved. Continuing will discard them.",
    keepEditing: "Keep editing",
    discardChanges: "Discard changes",
    sections: {
      account: "Account",
      appearance: "Appearance",
      product: "Workspace preferences",
      administration: "Product administration",
      channels: "Channels",
      memory: "Memory",
      subagents: "Subagents",
      notification: "Notification",
      about: "About",
    },
    productPreferences: {
      title: "Workspace display",
      description:
        "These preferences are saved to your account and sync across devices.",
      loading: "Loading personal preferences…",
      loadError:
        "Could not load preferences. Check the product settings API and retry.",
      extensionMissing:
        "The Flow Desk product extension is not installed in this Gateway. Ask the deployment administrator to install and enable it to use workspace preferences.",
      densityLabel: "Content density",
      comfortable: "Comfortable",
      compact: "Compact",
      save: "Save preferences",
      saving: "Saving…",
      unsaved: "Unsaved changes",
      saved: "Saved",
      saveError: "Could not save preferences. Try again later.",
      dataTitle: "Personal data tasks",
      dataDescription:
        "Export individual data categories in the background or create a ZIP bundle of the categories currently supported. The combined bundle still does not contain all account data. Preference removal is a separate, narrowly scoped action. You can leave this page while a task runs.",
      dataScopeNote:
        "Choose one export category or combine currently supported categories into a ZIP. Every export includes coverage notes, and unavailable data is listed. Host data exports are partial, not backups or full account exports.",
      dataScopeDetails: "Review export coverage by category",
      dataExportActionsTitle: "Export data",
      dataDeletionActionsTitle: "Clear personal data",
      dataDeletionActionsDescription:
        "Review the scope before continuing. Each action requires the exact confirmation phrase, and some deletions cannot be undone.",
      capabilityLoading: "Checking which data can be cleared…",
      capabilityError:
        "Could not confirm which data can be cleared. Please retry. Exports remain available.",
      capabilityRetry: "Check clearing availability again",
      capabilityUnsupported:
        "This service does not currently support clearing this category.",
      capabilityChanged:
        "This category cannot currently be cleared. Confirmation is paused.",
      capabilityStaticMode: "Personal data cannot be cleared in demo mode.",
      capabilitySignedOut: "Sign in to see which personal data can be cleared.",
      dataAccountScopeNote:
        "The bundle contains one JSON file per supported category plus a coverage manifest. It remains a partial export: unavailable categories include a reason, and credentials, deployment settings, and LangGraph checkpoints are excluded.",
      dataThreadsScopeNote:
        "Conversation exports include thread summaries, Gateway-visible messages, and owner-checked run status, timing, Agent IDs, and token usage. They omit raw requests and error text; changes during paging may be missed. They exclude checkpoints, files, Agents, Projects, memories, credentials, and Flow Desk preferences.",
      dataProjectsScopeNote:
        "Project metadata exports include names, instructions, presentation settings, status, and timestamps only. They exclude project documents, conversation history, uploads, generated files, memories, credentials, and checkpoints.",
      dataScheduledTasksScopeNote:
        "Scheduled task exports contain task definitions and cadence only. They exclude run history, run IDs, error details, leases, credentials, and checkpoints; changes during paging may be omitted.",
      dataAgentsScopeNote:
        "Agent exports contain settings and SOUL text for Agents created by this account. They exclude deployment-shared Agents, GitHub repository bindings, credentials, skill contents, memory contents, and checkpoints; changes during paging may be omitted.",
      dataMemoryScopeNote:
        "Memory exports use the configured backend's owner-scoped memory view. Local DeerMem includes shared summaries and the default-Agent bucket; other backends may expose a different owner-scoped view. Credentials, provider-private fields, and checkpoints are excluded; changes during the read may be omitted.",
      dataFilesScopeNote:
        "File exports include Gateway-readable thread uploads, generated thread outputs, bounded workspace files, and original files on the Project shelf. Workspace scans stop after 200 directories per thread and 20,000 total. Sensitive-looking workspace paths, generated directories, links, and junctions are excluded. File contents are not scanned for secrets, so review the partial export before sharing it. Deleted documents, converted previews, and other host files are excluded; each package is limited to 5,000 files, 7 MiB of source bytes, and 10 MiB of JSON.",
      dataNotEnabled:
        "If this feature is intentionally disabled, ask an administrator to enable product data jobs in the trusted Gateway extension configuration.",
      dataLoading: "Loading personal data tasks…",
      dataLoadError: "Could not load personal data tasks.",
      dataActiveCheckFailed:
        "The latest task status could not be checked, so new tasks are paused for now.",
      dataRetry: "Retry",
      dataPendingExport: "Unconfirmed export request",
      dataPendingDeletion: "Unconfirmed deletion request",
      dataSubmissionUnconfirmed:
        "This request may have reached the server, but its response was not confirmed. Retry the same request to recover its task result.",
      dataCheckSubmission: "Retry the same request",
      dataRecoveryUnavailable:
        "Browser session storage is unavailable, so data tasks are paused to protect request recovery. Restore browser storage and reload this page.",
      dataJobsLabel: "Recent personal data tasks",
      dataJobsPagination: "Personal data task pages",
      dataJobsPrevious: "Previous page",
      dataJobsNext: "Next page",
      dataJobsPage: "Page {page}",
      dataEmpty: "No personal data tasks yet.",
      dataPageEmpty: "There are no personal data tasks on this page.",
      dataExport: "Export preferences",
      dataAccountExport: "Export supported data bundle (partial ZIP)",
      dataThreadsExport: "Export conversation history (partial)",
      dataProjectsExport: "Export project metadata (partial)",
      dataScheduledTasksExport: "Export scheduled tasks (partial)",
      dataAgentsExport: "Export my Agents (partial)",
      dataMemoryExport: "Export personal memory (partial)",
      dataFilesExport: "Export my files (partial)",
      dataDelete: "Delete saved preferences",
      dataDeleteThreads: "Clear my conversation history",
      dataDeleteScheduledTasks: "Delete scheduled task definitions",
      dataDeleteAgents: "Delete custom Agents",
      dataDeleteMemory: "Clear personal memory",
      dataDeleteProjects: "Remove my project spaces",
      dataDeleteFiles: "Delete my uploads and Project documents",
      dataSubmitting: "Submitting…",
      dataOperationError:
        "The operation could not be completed. Check that no other task is running, then retry.",
      dataDownload: "Download JSON",
      dataDownloadZip: "Download ZIP",
      dataDownloading: "Preparing download…",
      dataDownloadError:
        "The export could not be downloaded. It may have expired; create a new export and try again.",
      dataExpired:
        "This export has expired. Create a new export to download it.",
      dataCancelJob: "Cancel task",
      dataRetryExport: "Submit export again",
      dataCancelling: "Cancelling…",
      dataTaskFailureReasons: {
        temporary:
          "The background task stopped repeatedly. Check the Gateway and storage services, then submit a new task.",
        authorizationUnavailable:
          "The authorization service is temporarily unavailable. The background task will retry; submit it again later if it ultimately fails.",
        authorizationDenied:
          "Permission was revoked while the task was running. Deletions already completed cannot be automatically restored.",
        scopeUnavailable:
          "This deployment does not support the selected data scope. Check the Gateway extension and capability configuration, then try again.",
        sizeLimit:
          "The export exceeds the current size limit. Choose a smaller scope and try again.",
        unsupported:
          "The installed version does not support this operation or data scope. Upgrade the extension, then try again.",
        invalidData:
          "The Gateway returned data that could not be processed. Check version compatibility or contact an administrator.",
        integrity:
          "The export failed its integrity check and was discarded. Retry the export; contact an administrator if it happens again.",
        unknown:
          "The task failed. Check the service status, then submit a new task.",
      },
      dataDeleteDialogTitle: "Delete saved preferences?",
      dataDeleteDialogDescription:
        "This permanently deletes your Flow Desk preference settings only. It does not affect conversations, files, projects, memories, credentials, or checkpoints. Type the exact phrase below to queue the deletion.",
      dataDeleteThreadsDialogTitle: "Clear my conversation history?",
      dataDeleteThreadsDialogDescription:
        "This clears conversations you own, their uploaded files, generated outputs, workspace data, checkpoints, message events, and run usage. Active or failed deletions are retained and reported as partial; you can retry later. This cannot be undone and is not a full account erasure. Type the exact phrase to continue.",
      dataDeleteThreadsPhraseLabel: 'Type "DELETE THREAD HISTORY" to confirm',
      dataDeleteThreadsConfirm: "Clear conversation history",
      dataDeleteThreadsCancel: "Keep conversations",
      dataDeletePhraseLabel: 'Type "DELETE PREFERENCES" to confirm',
      dataDeleteConfirm: "Delete preferences",
      dataDeleteCancel: "Keep preferences",
      dataDeleteScheduledTasksDialogTitle: "Delete scheduled task definitions?",
      dataDeleteScheduledTasksDialogDescription:
        "This deletes scheduled task definitions owned by you and cancels queued occurrences that have not started. Tasks that are launching or running are retained and can be retried after they finish. Run history and session content created by tasks are retained. Cancelling this background job cannot restore definitions already deleted. This is not a full account erasure.",
      dataDeleteScheduledTasksPhraseLabel:
        'Type "DELETE SCHEDULED TASKS" to confirm',
      dataDeleteScheduledTasksConfirm: "Delete task definitions",
      dataDeleteScheduledTasksCancel: "Keep scheduled tasks",
      dataDeleteAgentsDialogTitle: "Delete custom Agents?",
      dataDeleteAgentsDialogDescription:
        "This deletes Agent definitions you created, their SOUL files, and memory files stored with those definitions. Deployment-shared Agents and standalone memory directories without a custom definition are retained. Cancelling the job cannot restore content already deleted. This is not a full account erasure. Type the exact phrase to continue.",
      dataDeleteAgentsPhraseLabel: 'Type "DELETE CUSTOM AGENTS" to confirm',
      dataDeleteAgentsConfirm: "Delete custom Agents",
      dataDeleteAgentsCancel: "Keep Agents",
      dataDeleteProjectsDialogTitle: "Remove my project spaces?",
      dataDeleteProjectsDialogDescription:
        "This removes the project spaces you own, detaches their conversations (which remain), and moves active project documents to Trash. Documents in Trash are retained until separately purged; project names, instructions, and presentation settings are removed. This is not a full account erasure. Type the exact phrase to continue.",
      dataDeleteProjectsPhraseLabel: 'Type "DELETE MY PROJECTS" to confirm',
      dataDeleteProjectsConfirm: "Remove project spaces",
      dataDeleteProjectsCancel: "Keep projects",
      dataDeleteMemoryDialogTitle: "Clear this account's personal memory?",
      dataDeleteMemoryDialogDescription:
        "This clears the memory summaries and facts managed for your account by the configured memory backend; each backend defines its exact scope. It does not delete Agent definitions or SOUL files, conversations, projects, files, or credentials, and is not a full account erasure. Clearing cannot be undone once it starts; a cancellation request at that point may still finish as completed. Type the exact phrase to continue.",
      dataDeleteMemoryPhraseLabel: 'Type "DELETE MY MEMORY" to confirm',
      dataDeleteMemoryConfirm: "Clear personal memory",
      dataDeleteMemoryCancel: "Keep personal memory",
      dataDeleteFilesDialogTitle: "Delete my files?",
      dataDeleteFilesDialogDescription:
        "This permanently deletes thread uploads you own and moves Project shelf documents to recoverable Trash. Generated outputs and thread workspace files remain because Gateway has no safe bulk-deletion capability for them yet. The task reports partial completion whenever files remain or catalog coverage is incomplete. This is not a full account erasure. Type the exact phrase to continue.",
      dataDeleteFilesPhraseLabel: 'Type "DELETE MY FILES" to confirm',
      dataDeleteFilesConfirm: "Delete supported files",
      dataDeleteFilesCancel: "Keep files",
      dataProgressLabel: "Data task progress",
      dataExportJob: "Preference export",
      dataAccountExportJob: "Combined data bundle export (partial)",
      dataThreadsExportJob: "Conversation history export (partial)",
      dataProjectsExportJob: "Project metadata export (partial)",
      dataScheduledTasksExportJob: "Scheduled task definition export (partial)",
      dataAgentsExportJob: "Custom Agent export (partial)",
      dataMemoryExportJob: "Personal memory export (partial)",
      dataFilesExportJob: "Personal file export (partial)",
      dataPartialBadge: "Partial export",
      dataPartialResultNote:
        "This package contains only the listed visible conversation history. It may not include concurrent changes and cannot restore checkpoints or other account data.",
      dataAccountExportPartialResultNote:
        "This ZIP combines the categories listed in its coverage manifest. Each category retains its own limits; credentials, deployment settings, LangGraph checkpoints, and runtime continuation state are excluded, so this is not a full account backup.",
      dataProjectsPartialResultNote:
        "This package contains project metadata only. It does not contain project documents or conversations and cannot restore checkpoints or other account data.",
      dataScheduledTasksPartialResultNote:
        "This package contains scheduled task definitions only. It excludes run history, run results, and runtime state, and cannot restore checkpoints or other account data.",
      dataAgentsPartialResultNote:
        "This package contains portable settings and SOUL text for Agents created by this account. It excludes deployment-shared definitions, GitHub bindings, credentials, skill contents, memory contents, and checkpoints.",
      dataMemoryPartialResultNote:
        "This package contains the current owner's memory view returned by the configured backend. Coverage may vary by backend; credentials, provider-private fields, and checkpoints are excluded, so this is not a complete backup.",
      dataFilesPartialResultNote:
        "This partial package contains Gateway-readable thread uploads, thread outputs, eligible thread workspace files, and active original Project shelf documents. Workspace scans stop after 200 directories per thread and 20,000 total. It skips sensitive-looking workspace paths, generated directories, links, and junctions, but does not scan file contents for secrets. Review it before sharing; deleted documents, converted previews, checkpoints, and other host data are excluded.",
      dataPartialDeletionBadge: "Partial deletion",
      dataDeleteJob: "Preference deletion",
      dataDeleteThreadsJob: "Conversation history deletion",
      dataDeleteScheduledTasksJob: "Scheduled task definition deletion",
      dataDeleteAgentsJob: "Custom Agent deletion",
      dataDeleteMemoryJob: "Personal memory clearing",
      dataDeleteFilesJob: "Personal file deletion",
      dataDeleteProjectsJob: "Project space removal",
      dataDeletedCount: "Removed {count} preference item(s).",
      dataDeletedThreadsCount:
        "{count} conversation(s) were deleted or no longer exist.",
      dataDeleteThreadsPartialCount:
        "{count} conversation(s) remain; {failed} deletion operation(s) could not be confirmed. Submit a new task to retry later.",
      dataDeletedScheduledTasksCount:
        "{count} scheduled task definition(s) were deleted or no longer exist.",
      dataDeleteScheduledTasksPartialCount:
        "{count} scheduled task definition(s) remain (for example, tasks that are running); {failed} more could not be confirmed. Retry after they finish.",
      dataDeletedAgentsCount:
        "{count} custom Agent definition(s) were deleted or no longer exist.",
      dataDeletedProjectsCount:
        "{count} project space(s) were removed or no longer exist.",
      dataDeleteProjectsCompleted:
        "Project documents remain in Trash; conversations remain available, detached from the removed projects.",
      dataDeleteMemoryCompleted:
        "Personal memory for this account was cleared through the configured memory backend.",
      dataDeletedFilesCount:
        "Deleted {count} upload(s) or moved Project document(s) to recoverable Trash.",
      dataDeleteFilesPartialCount:
        "{count} file(s) remain in the catalog; {failed} deletion operation(s) could not be confirmed. Generated outputs and thread workspace files are retained. Retry if the supported scope changes.",
      dataDeleteAgentsPartialCount:
        "{count} custom Agent(s) remain; {failed} deletion operation(s) could not be confirmed (this may include entries outside the definition list). Submit a new task to retry.",
      status: {
        queued: "Queued",
        running: "Running",
        retry_wait: "Retry scheduled",
        completed: "Completed",
        failed: "Failed",
        cancelled: "Cancelled",
      },
      stage: {
        queued: "Waiting for a worker",
        inventory: "Collecting data",
        deleting: "Removing selected data",
        history: "Reading conversation history",
        packaging: "Preparing the export package",
        finalizing: "Finishing the deletion",
        other: "Processing",
      },
    },
    productAdmin: {
      accountsTitle: "Account access",
      accountsDescription:
        "Review deployment accounts and control sign-in access. Disabling revokes sessions and personal access tokens and requests cancellation of the account’s running Agent tasks; keep at least one active administrator.",
      accountsLoading: "Loading accounts…",
      accountsLoadError:
        "Could not load accounts. Check Gateway availability and administrator access.",
      refreshFailed:
        "Refresh failed. Showing the last successfully loaded data.",
      accountsEmpty: "There are no accounts yet.",
      accountEmail: "Email",
      accountRole: "Role",
      accountStatus: "Status",
      accountCreated: "Created",
      accountSetup: "Setup",
      accountActions: "Actions",
      accountAdmin: "Administrator",
      accountMember: "Member",
      accountActive: "Can sign in",
      accountDisabled: "Disabled",
      accountReady: "Setup complete",
      accountNeedsSetup: "Setup required",
      disableAccount: "Disable account",
      enableAccount: "Enable account",
      disableAccountFor: (email) => `Disable account ${email}`,
      enableAccountFor: (email) => `Enable account ${email}`,
      confirmAccountStatus: "Change this account’s status?",
      confirmDisableDescription:
        "This account will lose sign-in and personal access token access. The Gateway will also stop running tasks and report any task it could not confirm as stopped.",
      confirmEnableDescription:
        "This account can sign in again. Existing sessions and tokens from before deactivation will stay revoked.",
      cancel: "Cancel",
      confirm: "Confirm change",
      updatingAccount: "Updating…",
      accountUpdateError:
        "Could not update the account. Check its status and your administrator access, then try again.",
      accountStatusConflict:
        "This change would disable your own account or the last active administrator.",
      accountRunStopSummary:
        "Account disabled: {stopped} task(s) stopped, {pending} cancellation request(s) pending across Gateway workers, and {failed} task(s) could not be confirmed stopped.",
      accountsNewer: "Previous",
      accountsOlder: "Next",
      accountCount: "{count} accounts",
      configTitle: "Product configuration",
      configDescription:
        "Update product names and workspace entry flags online. Changes apply immediately with version conflict protection.",
      configLoadError:
        "Could not load product settings. Check that the extension is installed and your account is an administrator.",
      englishName: "English product name",
      chineseName: "Chinese product name",
      featureTitle: "Workspace entries",
      features: {
        overview: "Workspace overview",
        chats: "Chats",
        agents: "Agents",
        scheduled_tasks: "Scheduled tasks",
        capabilities: "Capability center",
        files: "File center",
        data_privacy: "Data and privacy",
        administration: "Product administration",
      },
      featureUnavailable: "Unavailable",
      privacyNote:
        "These switches only control frontend entry visibility. Backend APIs continue to enforce data permissions.",
      unimplementedFeaturesNote:
        "The file center supports current Gateway thread and project files. A complete cross-storage index and account-wide export/deletion are still pending, so the data/privacy entry remains disabled.",
      save: "Save product settings",
      saving: "Saving…",
      unsaved: "Unsaved changes",
      saved: "Saved",
      saveError: "Could not save settings. Try again later.",
      version: "Configuration version {version}",
      versionConflict:
        "Another administrator changed these settings. Reload the latest version first.",
      reload: "Reload",
      title: "Activity audit",
      description:
        "Administrators only. Events contain operation metadata, never preference values, message text, or credentials.",
      loading: "Loading audit events…",
      loadError:
        "Could not load events. Check that product administration is enabled and your account is an administrator.",
      retry: "Retry",
      empty: "No product activity yet.",
      time: "Time",
      actor: "Actor",
      action: "Action",
      resource: "Resource",
      result: "Result",
      auditActions: {
        preferenceSaved: "Saved a personal preference",
        preferenceDeleted: "Deleted a personal preference",
        productDisplayUpdated: "Updated product display settings",
        accountEnabled: "Enabled an account",
        accountDisabled: "Disabled an account",
        dataExportRequested: "Requested a personal data export",
        dataDeletionRequested: "Requested deletion of personal preferences",
        dataExportCompleted: "Completed a personal data export",
        dataDeletionCompleted: "Deleted personal preferences",
        dataJobCancelRequested: "Requested cancellation of a personal data job",
        dataJobCancelled: "Cancelled a personal data job",
        dataJobFailed: "A personal data job failed",
        dataExportDownloadRequested:
          "Requested a personal data export download",
        threadCreated: "Created a conversation",
        threadBranched: "Created a conversation branch",
        threadUpdated: "Updated conversation details",
        threadMoved: "Changed a conversation's project",
        threadDeleted: "Deleted a conversation",
        uploadCreated: "Uploaded a conversation file",
        uploadDeleted: "Deleted a conversation file",
        projectDocumentTrashed: "Moved a project document to trash",
        projectDocumentRestored: "Restored a project document",
        projectDocumentPurged: "Permanently deleted a project document",
        projectTrashEmptied: "Emptied the project trash",
        projectCreated: "Created a project",
        projectUpdated: "Updated a project",
        projectArchived: "Archived a project",
        projectRestored: "Restored a project",
        projectDeleted: "Deleted a project",
        scheduledTaskCreated: "Created a scheduled task",
        scheduledTaskUpdated: "Updated a scheduled task",
        scheduledTaskPaused: "Paused a scheduled task",
        scheduledTaskResumed: "Resumed a scheduled task",
        scheduledTaskTriggered: "Manually triggered a scheduled task",
        scheduledTaskDeleted: "Deleted a scheduled task",
        memoryCleared: "Cleared memory",
        memoryExported: "Exported memory",
        memoryImported: "Imported memory",
        memoryFactCreated: "Added a memory fact",
        memoryFactUpdated: "Updated a memory fact",
        memoryFactDeleted: "Deleted a memory fact",
        customAgentCreated: "Created a custom agent",
        customAgentUpdated: "Updated a custom agent",
        customAgentDeleted: "Deleted a custom agent",
        skillInstalled: "Installed a Skill package",
        skillUpdated: "Edited custom Skill content",
        skillDeleted: "Deleted a custom Skill",
        skillRolledBack: "Rolled back custom Skill content",
        skillEnabled: "Enabled a Skill",
        skillDisabled: "Disabled a Skill",
        skillsReloaded: "Reloaded Skill cache",
        userProfileUpdated: "Updated the user profile",
        patCreated: "Created a personal access token",
        patRevoked: "Revoked a personal access token",
        passwordChanged: "Changed the account password",
        accountRegistered: "Registered an account",
        adminInitialized: "Initialized the first administrator",
        oidcAccountProvisioned: "Provisioned an account through OIDC",
        oidcLoginSucceeded: "Signed in through OIDC",
        other: "Other activity",
      },
      auditResources: {
        userSetting: "Personal preference",
        productConfiguration: "Product display settings",
        account: "Account",
        dataJob: "Personal data job",
        thread: "Conversation",
        threadUpload: "Conversation file",
        projectDocument: "Project document",
        projectTrash: "Project trash",
        project: "Project",
        scheduledTask: "Scheduled task",
        memory: "Memory",
        memoryFact: "Memory fact",
        customAgent: "Custom agent",
        skill: "Skill",
        userProfile: "User profile",
        personalAccessToken: "Personal access token",
        other: "Other resource",
      },
      auditOutcomes: {
        success: "Success",
        notFound: "Not found",
        failure: "Failed",
        cancelled: "Cancelled",
        other: "Other result",
      },
      requestId: "Request ID",
      newer: "Newer",
      older: "Older",
    },
    memory: {
      title: "Memory",
      description:
        "The app can learn from your conversations in the background. These memories help it understand your preferences and deliver a more personal experience.",
      loadFailed: "Memory could not be loaded.",
      refreshFailed:
        "Refresh failed. Showing the last successfully loaded memory.",
      retry: "Retry loading",
      retrying: "Retrying…",
      empty: "No memory data to display.",
      rawJson: "Raw JSON",
      exportButton: "Export memory",
      exportFailed: "Could not export memory. Please try again.",
      exportSuccess: "Memory exported",
      importButton: "Import memory",
      importFailed: "Could not import memory. Check the file and try again.",
      importConfirmTitle: "Import memory?",
      importConfirmDescription:
        "This will overwrite your current memory with the selected JSON backup.",
      importFileLabel: "Selected file",
      importInvalidFile:
        "Failed to read the selected memory file. Please choose a valid JSON export.",
      importSuccess: "Memory imported",
      manualFactSource: "Manual",
      addFact: "Add fact",
      addFactTitle: "Add memory fact",
      editFactTitle: "Edit memory fact",
      addFactSuccess: "Fact created",
      editFactSuccess: "Fact updated",
      clearAll: "Clear all memory",
      clearAllFailed: "Could not clear memory. Please try again.",
      clearAllConfirmTitle: "Clear all memory?",
      clearAllConfirmDescription:
        "This will remove all saved summaries and facts. This action cannot be undone.",
      clearAllSuccess: "All memory cleared",
      factDeleteConfirmTitle: "Delete this fact?",
      factDeleteConfirmDescription:
        "This fact will be removed from memory immediately. This action cannot be undone.",
      factDeleteSuccess: "Fact deleted",
      factDeleteFailed: "Could not delete this fact. Please try again.",
      factContentLabel: "Content",
      factCategoryLabel: "Category",
      factConfidenceLabel: "Confidence",
      factContentPlaceholder: "Describe the memory fact you want to save",
      factCategoryPlaceholder: "context",
      factConfidenceHint: "Use a number between 0 and 1.",
      factSave: "Save fact",
      factSaveFailed: "Could not save this fact. Please try again.",
      factValidationContent: "Fact content cannot be empty.",
      factValidationConfidence: "Confidence must be a number between 0 and 1.",
      noFacts: "No saved facts yet.",
      summaryReadOnly:
        "Summary sections are read-only for now. You can currently add, edit, or delete individual facts, or clear all memory.",
      memoryFullyEmpty: "No memory saved yet.",
      factPreviewLabel: "Fact to delete",
      searchPlaceholder: "Search memory",
      filterAll: "All",
      filterFacts: "Facts",
      filterSummaries: "Summaries",
      noMatches: "No matching memory found.",
      markdown: {
        overview: "Overview",
        userContext: "User context",
        work: "Work",
        personal: "Personal",
        topOfMind: "Top of mind",
        historyBackground: "History",
        recentMonths: "Recent months",
        earlierContext: "Earlier context",
        longTermBackground: "Long-term background",
        updatedAt: "Updated at",
        facts: "Facts",
        empty: "(empty)",
        table: {
          category: "Category",
          confidence: "Confidence",
          confidenceLevel: {
            veryHigh: "Very high",
            high: "High",
            normal: "Normal",
            unknown: "Unknown",
          },
          content: "Content",
          source: "Source",
          createdAt: "CreatedAt",
          view: "View",
        },
      },
    },
    appearance: {
      themeTitle: "Theme",
      themeDescription:
        "Choose how the interface follows your device or stays fixed.",
      system: "System",
      light: "Light",
      dark: "Dark",
      systemDescription: "Match the operating system preference automatically.",
      lightDescription: "Bright palette with higher contrast for daytime.",
      darkDescription: "Dim palette that reduces glare for focus.",
      languageTitle: "Language",
      languageDescription: "Switch between languages.",
    },
    tools: {
      adminRequired: "Admin privileges are required to manage MCP tools.",
      loadFailed: "MCP tools could not be loaded.",
      empty: "No MCP tools configured.",
      addServer: "Add server",
      addServerDescription:
        "Paste the JSON definition published by the MCP server. Both a bare server map and one wrapped in `mcpServers` are accepted. Existing names must be changed through Edit.",
      addServerPlaceholder: `{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@my-org/my-mcp-server"]
    }
  }
}`,
      serverDefinitionLabel: "MCP server JSON definition",
      definitionEmpty: "Paste an MCP server definition.",
      definitionInvalidJson: "Enter valid JSON.",
      definitionRootNotObject:
        "Enter a JSON object describing one or more MCP servers.",
      definitionNoServers: "No MCP server was found in the definition.",
      definitionServerNotObject:
        'The configuration for server "{name}" must be a JSON object.',
      editServer: "Edit MCP server",
      editServerDescription:
        'Edit the complete JSON definition for "{name}". The server name is fixed; add a new server and remove this one to rename it.',
      editSingleServer: "Edit exactly one MCP server at a time.",
      editServerNameMismatch:
        'Keep the existing server name "{name}" while editing.',
      serverAlreadyExists:
        'MCP server "{name}" already exists. Use Edit instead.',
      removeServer: "Remove MCP server",
      removeServerDescription:
        'Remove "{name}" from the MCP configuration? Its tools stop being available to agents.',
      unnamedServer: "(empty name)",
      enableFailed: "Could not update the MCP server. Please try again.",
      addFailed: "Could not add the MCP server. Please try again.",
      updateFailed: "Could not save the MCP server. Please try again.",
      deleteFailed: "Could not remove the MCP server. Please try again.",
    },
    subagents: {
      title: "Subagents",
      description:
        "Reusable workers that the Lead Agent and permitted Custom Agents can delegate bounded tasks to.",
      executionNote:
        "Each invocation starts a fresh temporary context with no persistent chat or memory and cannot ask the user follow-up questions. A system prompt changes behavior; tools and skills grant actual capabilities.",
      adminNote:
        "You can view the catalog. Only administrators can add, edit, enable, or delete subagents.",
      create: "Add subagent",
      createFailed: "Failed to create subagent",
      loadFailed: "Could not load subagents.",
      refreshFailed:
        "Refresh failed. Showing the last successfully loaded subagents.",
      retry: "Try again",
      retrying: "Retrying…",
      empty: "No subagents are available.",
      sourceBuiltin: "Built-in",
      sourceConfig: "config.yaml",
      sourceManaged: "Managed",
      conflict: "Name conflict — excluded from runtime",
      overridden: "Some runtime values are overridden by config.yaml",
      createTitle: "Add managed subagent",
      editTitle: "Edit managed subagent",
      name: "Name",
      nameHint: "Use letters, numbers, and hyphens only.",
      displayName: "Display name",
      descriptionLabel: "Delegation description",
      systemPrompt: "System prompt",
      model: "Model",
      inheritModel: "Inherit from caller",
      tools: "Allowed tools (comma-separated)",
      skills: "Skills (comma-separated)",
      listModeAll: "Inherit all available",
      listModeNone: "Allow none",
      listModeSelected: "Allow selected names",
      listNamesPlaceholder: "Comma-separated names",
      maxTurns: "Maximum turns",
      timeout: "Timeout (seconds)",
      created: "Subagent created",
      saved: "Subagent saved",
      unsaved: "The subagent configuration has unsaved changes.",
      updateFailed: "Failed to save subagent changes",
      deleted: "Subagent deleted",
      deleteFailed: "Failed to delete subagent",
      deleteTitle: "Delete subagent",
      deleteConfirm:
        "Delete this managed subagent? Custom Agents may keep referencing its name, and recreating the same name will reconnect those bindings. This cannot be undone.",
      bindingTitle: "Subagent access",
      bindingDescription:
        "Choose which subagents this Custom Agent may invoke. This is enforced by the server.",
      allAllowed: "All enabled subagents",
      noneAllowed: "No subagents",
      selectedAllowed: "Selected subagents",
      missing: "Missing or unavailable; deselect to remove",
    },
    channels: {
      title: "Channels",
      description:
        "Connect messaging accounts that can send messages to your agent from outside the browser.",
      disabled:
        "Channel connections are not enabled on this server. Ask an administrator to enable channel_connections.",
      loadFailed: "Channel status could not be loaded.",
      refreshFailed:
        "Refresh failed. Showing the last successfully loaded channel status.",
      retry: "Reload status",
      retrying: "Retrying…",
    },
    integrations: {
      title: "Integrations",
      description:
        "Connect third-party tools and work platforms so agents can use them directly.",
      refresh: "Refresh",
      install: "Install",
      reinstall: "Reinstall",
      installing: "Installing...",
      ready: "Ready",
      pending: "Pending",
      available: "Available",
      unavailable: "Unavailable",
      connected: "Connected",
      loadFailed: "Failed to load integration status",
      adminRequired: "Admin privileges are required to install integrations.",
      permissionRequired:
        "You do not have permission to manage this integration.",
      lark: {
        title: "Lark / Feishu CLI",
        description:
          "Install the official Lark/Feishu agent skills and let agents use Lark after authorization.",
        skillPack: "Skill pack",
        gatewayCli: "Gateway CLI",
        auth: "Auth",
        sandboxRuntime: "Sandbox runtime",
        sandboxRuntimeInitContainer: "Provisioned by init container",
        sandboxRuntimeBroker: "Provisioned by broker sidecar",
        sandboxRuntimeGatewayDownload: "Provisioned by Gateway",
        sandboxRuntimeNotReady:
          "Not ready — lark-cli may be missing at chat time",
        notInstalled: "Not installed",
        skillsInstalled: (installed, expected) =>
          `${installed}/${expected} skills installed`,
        installedVersion: (version) => `Installed: ${version}`,
        updateAvailable: (version) =>
          `Update available: ${version} — admin reinstall updates the managed Gateway CLI and skill pack`,
        runtimeVersionMismatch:
          "Skill pack version differs from the Gateway runtime lark-cli; admin reinstall attempts to update the managed Gateway CLI and realign the skill pack",
        authNotConfigured: "Not connected",
        authConfigured: "Credentials configured (not live-verified)",
        authConfiguredFor: (user) =>
          `${user} · credentials configured (not live-verified)`,
        statusLoadFailed:
          "Couldn't load Lark integration status. Refresh and try again.",
        installFailed:
          "Couldn't install the Lark integration. Refresh its status and try again.",
        connectionFailed:
          "Lark connection setup did not finish. Refresh its status and try again.",
        authorizationFailed:
          "Lark authorization did not finish. Complete the browser step and try again.",
        authorizationSuperseded:
          "A newer connection replaced this authorization. Start the connection again.",
        authorizationCheckEnded:
          "Automatic authorization checks ended without confirming completion. Start the connection again to continue.",
        restartConnection: "Start connection again",
        connect: "Connect Lark",
        authStarting: "Opening connection link...",
        checkingConnection: "Checking connection...",
        connectedAction: "Reconnect Lark",
        requestPermissions: "Request permissions",
        alreadyConnected:
          "Lark is already connected. If authorization expires, refresh the status and reconnect.",
        changeAppButton: "Change Lark app",
        changeAppTitle: "Switch to a different Lark app",
        changeAppDescription:
          "Use a different Lark/Feishu app for this account. This only affects your account; other users are not changed.",
        changeAppIdLabel: "App ID",
        changeAppSecretLabel: "App Secret",
        changeAppAuthResetNote:
          "Switching revokes the previous app's authorization. You will authorize the new app next.",
        changeAppSubmit: "Switch app",
        changeAppReRegister: "Re-register in browser",
        changeAppSwitched:
          "Lark app switched. Reconnect to authorize the new app.",
        changeAppFailed:
          "Couldn't switch Lark apps. Check the details and try again.",
        brandFeishu: "Feishu",
        brandLark: "Lark",
        connectionStarted: "Connection link opened",
        connectionReady: "Connection is ready. Opening authorization...",
        authStarted:
          "Authorization page opened. The app will detect completion automatically.",
        authorizationStillPending:
          'Authorization is not complete yet. Finish it in the browser; the app keeps checking automatically. You can click "I completed authorization" if the page does not update.',
        permissionTitle: "Authorization scope",
        permissionDescription:
          "By default, sign-in does not request any business permissions. Select the domains you need here; connected users can re-authorize to add more (scopes accumulate).",
        authDomains: {
          calendar: {
            label: "Calendar",
            description:
              "Events, free/busy, RSVP, and meeting-room scheduling.",
          },
          im: {
            label: "Messenger",
            description:
              "Send/reply messages, manage group chats, search history, download media.",
          },
          docs: {
            label: "Docs",
            description: "Create, read, update, and search documents.",
          },
          drive: {
            label: "Drive",
            description:
              "Upload/download files, search docs & wiki, manage comments.",
          },
          sheets: {
            label: "Sheets",
            description: "Read, write, append, find, and export spreadsheets.",
          },
          base: {
            label: "Base",
            description:
              "Bitable tables, fields, records, views, dashboards, and workflows.",
          },
          wiki: {
            label: "Wiki",
            description: "Knowledge spaces, nodes, and wiki documents.",
          },
          task: {
            label: "Tasks",
            description:
              "Tasks, task lists, subtasks, comments, and reminders.",
          },
          mail: {
            label: "Mail",
            description:
              "Browse, search, read, send, reply, forward, and manage drafts.",
          },
          vc: {
            label: "Meetings",
            description: "Meeting records, minutes artifacts, and recordings.",
          },
          minutes: {
            label: "Minutes",
            description: "Meeting minutes content and transcripts.",
          },
          note: {
            label: "Notes",
            description: "Meeting notes and related content.",
          },
          slides: {
            label: "Slides",
            description: "Presentations and slide content.",
          },
          markdown: {
            label: "Markdown",
            description:
              "Create, fetch, patch, and overwrite Drive-native .md files.",
          },
          mindnotes: {
            label: "Mind notes",
            description: "Mind notes content.",
          },
          contact: {
            label: "Contacts",
            description: "Look up users by name/email/phone and read profiles.",
          },
          approval: {
            label: "Approval",
            description:
              "Query and act on approval tasks; cancel and CC instances.",
          },
          attendance: {
            label: "Attendance",
            description: "Query personal attendance check-in records.",
          },
          okr: {
            label: "OKR",
            description:
              "Objectives, key results, alignments, indicators, and progress.",
          },
          event: {
            label: "Events",
            description: "Subscribe to and consume real-time platform events.",
          },
          apps: {
            label: "Apps",
            description:
              "Create Spark/Miaoda apps, publish sites, and manage access scope.",
          },
          all: {
            label: "All",
            description:
              "Request every business domain supported by lark-cli. Use this only when the missing permission is unclear.",
          },
        },
        customScopeLabel: "Exact OAuth scope",
        customScopePlaceholder: "For example calendar:calendar.event:read",
        customScopeDescription:
          "Advanced: if an error reports a missing scope, paste it here. Examples: calendar:calendar.event:read, calendar:calendar.free_busy:read.",
        openConnectionLinkTitle: "Continue connecting Lark",
        openConnectionLinkDescription:
          "The first connection needs one browser confirmation from Lark. Open the link below and finish the prompt, then return here to continue authorization.",
        openAuthLinkTitle: "Authorize Lark in your browser",
        openAuthLinkDescription:
          "Open the link below to authorize. The app keeps checking automatically and will save the connection after approval.",
        waitingAuthTitle: "Waiting for Lark authorization",
        waitingAuthDescription:
          "Finish authorization in the browser page that just opened. This panel will update automatically; the button below is only a fallback.",
        openAuthLink: "Open link",
        copyAuthLink: "Copy link",
        completeAuth: "I completed authorization",
        continueAuth: "I completed browser confirmation, continue",
        preparingAuthorization: "Preparing authorization...",
        completingAuth: "Checking...",
        authExpiresIn: (seconds) =>
          `This link expires in about ${seconds} seconds.`,
        installingTitle: "Installing official skill pack",
        installingDescription:
          "This usually finishes within 30 seconds; slower networks may take about 1 minute. The status refreshes automatically when installation completes.",
        installNextTitle: "Install the official skill pack first",
        installNextDescription:
          "After installation, /lark-doc, /lark-im, /lark-sheets and related skills appear in the skill index.",
        cliNextTitle: "Install Gateway CLI",
        cliNextDescription:
          "The skill pack is installed, but the Gateway cannot find lark-cli. Admin reinstall attempts to download the managed Gateway CLI; offline deployments can use an image with @larksuite/cli built in.",
        configuredTitle: "Lark credentials are configured locally",
        configuredDescription:
          "Credentials are present, but their current validity has not been checked with Lark. Reconnect to refresh and live-verify authorization.",
        connectedTitle: "Lark authorization is live-verified",
        connectedDescription:
          "The current user's authorization was verified with Lark during this connection flow. Reconnect whenever you need to refresh it or add permissions.",
        authNextTitle: "Complete browser authorization next",
        authNextDescription:
          "Click “Connect Lark”; the app checks the current status first and opens browser authorization only when disconnected or expired.",
      },
    },
    skills: {
      exportPrevious: "Previous 50 files",
      exportNotices: {
        skill_export_yaml_alias:
          "YAML aliases are not supported for export. Replace aliases with explicit values in SKILL.md.",
        skill_export_yaml_complexity:
          "The YAML declarations are too deeply nested or complex to export.",
        skill_export_invalid_declaration:
          "A malformed credential declaration was omitted; inspect SKILL.md.",
        skill_export_link: "Linked files or directories cannot be exported.",
        skill_export_unsupported_node:
          "Only ordinary files and directories are supported; hard links and special files cannot be exported.",
        skill_export_invalid_path:
          "This path is not portable or conflicts with another path.",
        skill_export_nested_skill:
          "Nested SKILL.md files are not accepted by the installer.",
        skill_export_executable_binary:
          "Executable binaries are not accepted by the installer.",
        skill_export_invalid_frontmatter:
          "SKILL.md must have valid declarations and its name must match the skill folder.",
        skill_export_sensitive_filename:
          "This filename may contain local credentials or repository metadata.",
        skill_export_platform_declarations:
          "Configure the declared tools and credentials in the destination environment.",
      },
      exportSkill: "Export",
      exportTitle: "Export skill",
      exportDescription: "Download the currently saved skill as a .skill file.",
      exportLoading: "Preparing file list…",
      exportFiles: "Files",
      exportDirectories: "Directories",
      exportSize: "Uncompressed size",
      exportContents: "Package contents",
      exportMore: "Next 50 files",
      exportRequirements: "Declared requirements",
      exportCompatibility: "Compatibility",
      exportTools: "Allowed tools",
      exportSecrets: "Credential names",
      exportOptional: "optional",
      exportRequired: "required",
      exportUndeclared: "Not declared",
      exportScope:
        "Includes all files inside this skill. Account settings, conversations and history outside the skill folder are excluded. Configure tools and credentials again on the destination.",
      exportWarnings: "Check package contents",
      exportWarningDescription:
        "These notices are based on filenames and declarations. Secrets written inside package files are included unchanged. This is not a security scan.",
      exportBlocked: "This package cannot be exported",
      exportDownload: "Download .skill",
      exportDownloading: "Preparing download…",
      exportHandedOff: "File handed to your browser for download.",
      exportChanged:
        "The skill changed. Refresh the file list before downloading.",
      exportRefresh: "Refresh file list",
      exportFailed: "Could not export this skill. Try again.",
      exportBusy: "Two exports are active. Try again shortly.",
      exportTimeout: "Preparing the package timed out. Try again shortly.",
      exportLimit: "The package exceeds an export limit.",
      exportNotFound:
        "This custom skill no longer exists. Refresh the skill list.",
      createSkill: "Create skill",
      emptyTitle: "No agent skill yet",
      emptyDescription:
        "Put your agent skill folders in the configured custom skills directory, usually `/skills/custom`.",
      emptyButton: "Create Your First Skill",
      adminRequired: "Admin privileges are required to manage agent skills.",
      installAdminRequired:
        "Admin privileges are required to install agent skills.",
      loadFailed: "Skills could not be loaded.",
      refreshFailed:
        "Refresh failed. Showing the skills from the last successful load.",
      retry: "Try again",
      retrying: "Retrying…",
      enableFailed: "Could not update the skill. Please try again.",
      installFromFile: "Install .skill",
      installingArchive: "Installing...",
      invalidArchive: "Choose a file with the .skill extension.",
      archiveTooLarge: "The skill archive must be 100 MiB or smaller.",
      installFailed: "Failed to install the skill archive.",
      installBlocked:
        "Security checks did not pass. The skill was not installed.",
    },
    notification: {
      title: "Notification",
      description:
        "The app only sends a completion notification when the window is not active. This is especially useful for long-running tasks so you can switch to other work and get notified when done.",
      requestPermission: "Request notification permission",
      deniedHint:
        "Notification permission was denied. You can enable it in your browser's site settings to receive completion alerts.",
      testButton: "Send test notification",
      testTitle: "Flow Desk",
      testBody: "This is a test notification.",
      notSupported: "Your browser does not support notifications.",
      disableNotification: "Disable notification",
    },
    account: {
      profileTitle: "Profile",
      email: "Email",
      role: "Role",
      ssoProvider: "SSO",
      changePasswordTitle: "Change Password",
      changePasswordDescription: "Update your account password.",
      ssoPasswordDescription: "Password is managed by your SSO provider.",
      ssoPasswordMessage:
        "This account signs in with {provider}, so the app cannot manage or change its password here. Use your SSO provider's account settings instead.",
      currentPassword: "Current password",
      newPassword: "New password",
      confirmNewPassword: "Confirm new password",
      passwordMismatch: "New passwords do not match",
      passwordTooShort: "Password must be at least 8 characters",
      passwordChangedSuccess: "Password changed successfully",
      networkError: "Network error. Please try again.",
      updating: "Updating...",
      updatePassword: "Update Password",
      unsavedPasswordChanges: "The password form has unsaved changes.",
      exportDataTitle: "Export my data",
      exportDataDescription:
        "Create a partial JSON package from data this account can read through the Gateway. Eligible conversation workspace files are included; credential-looking names and unsafe paths are skipped, but file contents are not scanned for secrets, so review the package before sharing it. Attachments are capped at 100 MiB; deployment credential stores and resumable execution checkpoints are not read. You can cancel; current reads may finish before the remaining steps stop.",
      exportDataButton: "Generate and download",
      exportingData: "Preparing your data…",
      cancelDataExport: "Cancel export",
      cancellingDataExport: "Stopping…",
      exportDataCancelled: "Data export cancelled. No package was created.",
      exportStageInventory: "Collecting account data",
      exportStageHistory: "Preparing conversation history",
      exportStageFiles: "Reading file contents",
      exportStagePackage: "Building your data package",
      exportDataPartial:
        "The partial package is ready; failed resources are listed inside it. Eligible workspace files are included, but their contents were not scanned for secrets, so review the package before sharing it. Deployment credential stores and resumable execution checkpoints are not read. This is not a complete account export or a restorable backup.",
      exportDataError: "Unable to create the package. Please try again.",
      signOut: "Sign Out",
    },
    acknowledge: {
      emptyTitle: "Acknowledgements",
      emptyDescription: "Credits and acknowledgements will show here.",
    },
  },
  login: {
    heroKicker: "SELF-HOSTED AI WORKSPACE",
    heroTitle: "Move complex work\nforward, one step at a time.",
    heroDescription:
      "Bring conversations, Agents, and project context together in workflows your team can follow.",
    heroFeatures: [
      "Deploy in your own environment",
      "Coordinate Agents on multi-step work",
      "Keep conversations, tasks, and projects together",
    ],
    heroFooter: "Built for your team, running under your control.",
    signInTitle: "Sign in to your account",
    createAccountTitle: "Create a new account",
    email: "Email",
    emailPlaceholder: "you@example.com",
    password: "Password",
    passwordPlaceholder: "Enter your password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    rememberMe: "Keep me signed in",
    rememberMeDescription:
      "Keep this browser session when possible. The app stores only your email, never your password.",
    pleaseWait: "Please wait...",
    signIn: "Sign In",
    createAccount: "Create Account",
    createAdminAccount: "Create admin account",
    adminSetupRequiredTitle: "Administrator setup is required",
    adminSetupRequiredDescription:
      "An administrator account is required before new regular accounts can be created.",
    orContinueWith: "Or continue with",
    ssoHint:
      "If your account uses single sign-on, sign in with the option below instead.",
    continueWith: (provider: string) => `Continue with ${provider}`,
    noAccountSignUp: "Don't have an account? Sign up",
    haveAccountSignIn: "Already have an account? Sign in",
    backToHome: "← Back to home",
    networkError: "Network error. Please try again.",
    serviceUnavailableTitle: "Service temporarily unavailable",
    serviceUnavailableDescription:
      "The Gateway is unavailable right now. Check that the service is running, then try again.",
    retry: "Try again",
    authFailed: "Authentication failed.",
    errors: {
      sso_failed: "SSO login failed. Please try again or use email login.",
      sso_cancelled: "SSO login was cancelled.",
      sso_account_exists:
        "An account with this email already exists. Please sign in with your password or contact your administrator.",
      sso_not_allowed:
        "SSO login is not allowed for your account. Contact your administrator.",
    },
  },
  setup: {
    loading: "Checking setup status…",
    adminTitle: "Create the first administrator",
    adminDescription:
      "Set up the first admin account to start using your workspace.",
    emailPlaceholder: "you@example.com",
    adminPasswordPlaceholder: "At least 8 characters",
    confirmPassword: "Confirm password",
    confirmPasswordPlaceholder: "Enter the password again",
    setupTitle: "Finish administrator setup",
    setupDescription: "Set your email address and a new password to continue.",
    currentPassword: "Current password",
    currentPasswordPlaceholder: "Enter your current password",
    newPassword: "New password",
    newPasswordPlaceholder: "At least 8 characters",
    confirmNewPassword: "Confirm new password",
    confirmNewPasswordPlaceholder: "Enter your new password again",
    creatingAdmin: "Creating account…",
    savingPassword: "Saving password…",
    completeSetup: "Complete setup",
  },
};
