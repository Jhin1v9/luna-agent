'use strict';
/**
 * lib/tool-registry.cjs — Wave 5: THE single source of truth for Luna tools.
 *
 * One entry per dispatched tool name (129 luna-tools.cjs exports + 3 soul-only
 * dispatches: dashboardCommandRouter, ipython, computer = 132 entries):
 *   aliasOf — set when this name aliases another entry (web_search → searchWeb)
 *   schema  — guard input schema (moved VERBATIM from luna-tool-guard.cjs in Wave 5)
 *   meta    — frontend metadata { icon, color, label } harvested from ToolCard.svelte.
 *             label is null until the accepted UX-labels phase populates it.
 *
 * Consumers: luna-tool-guard.cjs derives TOOL_SCHEMAS via buildToolSchemas();
 * the frontend derives its icon/color maps via scripts/gen-tool-meta.cjs
 * (checked-in codegen — never hand-edit the generated file).
 * Desktop tools (luna-soul.cjs DESKTOP_TOOLS) are a separate dispatch subsystem
 * and intentionally NOT in this registry.
 */

const TOOL_REGISTRY = {
  "web_search": {
    aliasOf: "searchWeb",
    meta: { icon: "🌐", color: "#f97316", label: null },
  },
  "webSearch": {
    aliasOf: "searchWeb",
    meta: { icon: null, color: null, label: null },
  },
  "readFile": {
    schema: {
      required: ["path"],
      types: {
        path: "string",
        line_offset: "number",
        n_lines: "number",
      },
      pathMustExist: true,
    },
    meta: { icon: "👁", color: "#22c55e", label: null },
  },
  "writeFile": {
    schema: {
      required: ["path", "content"],
      types: {
        path: "string",
        content: "string",
      },
      pathMustBeAbsolute: true,
      // Wave 5 (5a): pathMustNotContain ["..","~"] removed — the soul's realpath
      // path-guard (lib/path-guard.cjs) is the traversal authority; the schema
      // no longer double-polices raw '..'/'~' in the path value.
    },
    meta: { icon: "📄", color: "#3b82f6", label: null },
  },
  "appendFile": {
    schema: {
      required: ["path", "content"],
      types: {
        path: "string",
        content: "string",
      },
    },
    meta: { icon: null, color: null, label: null },
  },
  "replaceInFile": {
    schema: {
      required: ["path", "old", "new"],
      types: {
        path: "string",
        old: "string",
        new: "string",
      },
      pathMustBeAbsolute: true,
    },
    meta: { icon: "✏️", color: "#06b6d4", label: null },
  },
  "deleteFile": {
    schema: {
      required: ["path"],
      types: {
        path: "string",
      },
    },
    meta: { icon: null, color: null, label: null },
  },
  "moveFile": {
    meta: { icon: null, color: null, label: null },
  },
  "copyFile": {
    meta: { icon: null, color: null, label: null },
  },
  "getFileInfo": {
    meta: { icon: null, color: null, label: null },
  },
  "listFiles": {
    meta: { icon: null, color: null, label: null },
  },
  "viewDirectory": {
    meta: { icon: null, color: null, label: null },
  },
  "createDirectory": {
    meta: { icon: null, color: null, label: null },
  },
  "removeDirectory": {
    meta: { icon: null, color: null, label: null },
  },
  "searchFiles": {
    meta: { icon: "🔍", color: "#f97316", label: null },
  },
  "grep": {
    schema: {
      required: ["pattern"],
      types: {
        pattern: "string",
        path: "string",
        type: "string",
      },
    },
    meta: { icon: null, color: null, label: null },
  },
  "glob": {
    schema: {
      required: ["pattern"],
      types: {
        pattern: "string",
      },
    },
    meta: { icon: null, color: null, label: null },
  },
  "searchWeb": {
    meta: { icon: "🌐", color: "#f97316", label: null },
  },
  "fetchURL": {
    meta: { icon: null, color: null, label: null },
  },
  "executeShell": {
    schema: {
      required: ["command"],
      types: {
        command: "string",
      },
      forbiddenPatterns: [/^\s*rm\s+-rf\s+\//, /^\s*mkfs/, /^\s*dd\s+if=/, /^\s*:\(\)\{\s*:\|:\s*&\s*\};:/],
    },
    meta: { icon: "⚡", color: "#a855f7", label: null },
  },
  "executeScript": {
    meta: { icon: null, color: null, label: null },
  },
  "runTests": {
    meta: { icon: null, color: null, label: null },
  },
  "checkSyntax": {
    meta: { icon: null, color: null, label: null },
  },
  "installPackages": {
    meta: { icon: null, color: null, label: null },
  },
  "gitStatus": {
    meta: { icon: "🌿", color: "#6b7280", label: null },
  },
  "gitDiff": {
    meta: { icon: "📊", color: "#6b7280", label: null },
  },
  "gitLog": {
    meta: { icon: "📜", color: "#6b7280", label: null },
  },
  "gitCommit": {
    meta: { icon: "💾", color: "#6b7280", label: null },
  },
  "applyPatch": {
    meta: { icon: null, color: null, label: null },
  },
  "downloadFile": {
    meta: { icon: null, color: null, label: null },
  },
  "browser": {
    schema: {
      required: ["url"],
      types: {
        url: "string",
      },
    },
    meta: { icon: "🌍", color: "#3b82f6", label: null },
  },
  "clipboardRead": {
    meta: { icon: null, color: null, label: null },
  },
  "clipboardWrite": {
    meta: { icon: null, color: null, label: null },
  },
  "readMediaFile": {
    meta: { icon: null, color: null, label: null },
  },
  "think": {
    meta: { icon: null, color: null, label: null, hidden: true },
  },
  "dashboardCreateTask": {
    meta: { icon: "📋", color: "#ec4899", label: null },
  },
  "dashboardListTasks": {
    meta: { icon: "📋", color: "#ec4899", label: null },
  },
  "dashboardUpdateTask": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardDeleteTask": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCompleteTask": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardAddComment": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreateLead": {
    meta: { icon: "👤", color: "#ec4899", label: null },
  },
  "dashboardListLeads": {
    meta: { icon: "👥", color: "#ec4899", label: null },
  },
  "dashboardUpdateLead": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardConvertLead": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardDeleteLead": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreatePayment": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListPayments": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardUpdatePayment": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardDeletePayment": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardReceiveSplit": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreateExpense": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListExpenses": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardUpdateExpense": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardDeleteExpense": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardPayExpense": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreateExpenseTemplate": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardQuickExpense": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetCashBox": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardAddCashEntry": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListCashHistory": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardReconcileCashBox": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardAdjustCashBox": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetCashBoxProjection": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreateCashPayment": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreateQuote": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListQuotes": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardUpdateQuote": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardDeleteQuote": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListProjects": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListClients": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreateIdea": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListIdeas": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardAddLink": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListLinks": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardDeleteLink": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardEnrichLink": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardSyncLinks": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetLinksStats": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardSendEmail": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListEmails": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardSyncEmails": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardSendWhatsApp": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetWhatsAppHistory": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardScanWhatsApp": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetWhatsAppStatus": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetWhatsAppClassifications": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetSystemStatus": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetSystemLogs": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardControlService": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListNotifications": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardMarkNotificationRead": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardMarkAllNotificationsRead": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListUsers": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListMembers": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListBugReports": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardDeleteBugReport": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListGitHubRepos": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListVercelProjects": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListOpsAlerts": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreateOpsAlert": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardDeleteOpsAlert": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListTransactions": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetNexoState": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetConfig": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetFinanceSummary": {
    meta: { icon: "💰", color: "#ec4899", label: null },
  },
  "dashboardListVotingSessions": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetVotingSession": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreateVotingSession": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardVoteInSession": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardDeleteVotingSession": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListRecentChanges": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListTrash": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardUndoLastChange": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardRestoreItem": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListRoadmaps": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardGetRoadmap": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreateRoadmap": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardAdvanceRoadmapPhase": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardListProjectTypes": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardJoinTimeline": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardAdvanceTimelineStep": {
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCreateReviewVote": {
    meta: { icon: null, color: null, label: null },
  },
  "getCurrentDirectory": {
    meta: { icon: null, color: null, label: null, hidden: true },
  },
  "setVisibleMode": {
    meta: { icon: "👁", color: "#22c55e", label: null, hidden: true },
  },
  "getVisibleMode": {
    meta: { icon: "🙈", color: "#94a3b8", label: null, hidden: true },
  },
  "lunaSelfUpdate": {
    meta: { icon: null, color: null, label: null },
  },
  "openDebugTerminal": {
    meta: { icon: null, color: null, label: null },
  },
  "validateProject": {
    schema: {
      required: ["path"],
      types: {
        path: "string",
      },
      pathMustBeAbsolute: true,
    },
    meta: { icon: null, color: null, label: null },
  },
  "dashboardCommandRouter": {
    meta: { icon: null, color: null, label: null },
  },
  "ipython": {
    schema: {
      required: ["code"],
      types: {
        code: "string",
      },
    },
    meta: { icon: "🐍", color: "#f59e0b", label: null },
  },
  "computer": {
    schema: {
      required: ["action"],
      types: {
        action: "string",
        x: "number",
        y: "number",
        text: "string",
      },
    },
    meta: { icon: null, color: null, label: null },
  },
};

function buildToolSchemas() {
  const schemas = {};
  for (const [name, entry] of Object.entries(TOOL_REGISTRY)) {
    // Shallow-frozen copy: consumers (the guard) must never mutate a schema and
    // thereby corrupt the shared registry entry. Nested objects stay shared by
    // reference on purpose — deep-freezing would break RegExp instances in
    // forbiddenPatterns and buys nothing since all consumers are read-only.
    if (entry.schema) schemas[name] = Object.freeze({ ...entry.schema });
  }
  return schemas;
}

module.exports = { TOOL_REGISTRY, buildToolSchemas };
