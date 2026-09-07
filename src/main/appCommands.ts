export type AppCommandId =
  | 'open-urls'
  | 'preferences'
  | 'find-downloads'
  | 'refresh-downloads'
  | 'pause-all'
  | 'resume-all'
  | 'clear-finished'
  | 'compact-window'
  | 'quit'

export type AppCommandKind = 'renderer-event' | 'main-action' | 'role'

export interface AppCommand {
  id: AppCommandId
  label: string
  accelerator?: string
  channel?: string
  role?: 'quit'
  kind: AppCommandKind
}

export interface AppCommandActions {
  sendToRenderer: (channel: string) => void
  pauseAll: () => void
  resumeAll: () => void
  openCompactWindow?: () => void
  quit: () => void
}

export const APP_COMMANDS: readonly AppCommand[] = [
  {
    id: 'open-urls',
    label: 'Open URLs…',
    accelerator: 'CmdOrCtrl+O',
    channel: 'open-urls',
    kind: 'renderer-event'
  },
  {
    id: 'preferences',
    label: 'Settings…',
    accelerator: 'CmdOrCtrl+,',
    channel: 'open-preferences',
    kind: 'renderer-event'
  },
  {
    id: 'find-downloads',
    label: 'Find Downloads',
    accelerator: 'CmdOrCtrl+F',
    channel: 'focus-download-search',
    kind: 'renderer-event'
  },
  {
    id: 'refresh-downloads',
    label: 'Refresh Downloads',
    accelerator: 'CmdOrCtrl+R',
    channel: 'refresh-downloads',
    kind: 'renderer-event'
  },
  {
    id: 'pause-all',
    label: 'Pause All',
    kind: 'main-action'
  },
  {
    id: 'resume-all',
    label: 'Resume All',
    kind: 'main-action'
  },
  {
    id: 'clear-finished',
    label: 'Clear Finished Downloads',
    channel: 'open-clear-downloads',
    kind: 'renderer-event'
  },
  {
    id: 'compact-window',
    label: 'Compact Window',
    kind: 'main-action'
  },
  {
    id: 'quit',
    label: 'Quit',
    role: 'quit',
    kind: 'role'
  }
]

const commandsById = new Map<AppCommandId, AppCommand>(
  APP_COMMANDS.map((command) => [command.id, command])
)

export function getAppCommand(id: AppCommandId): AppCommand {
  const command = commandsById.get(id)
  if (!command) {
    throw new Error(`Unknown app command: ${id}`)
  }
  return command
}

export function runAppCommand(id: AppCommandId, actions: AppCommandActions): void {
  const command = getAppCommand(id)
  if (command.kind === 'renderer-event' && command.channel) {
    actions.sendToRenderer(command.channel)
    return
  }
  if (command.id === 'pause-all') {
    actions.pauseAll()
    return
  }
  if (command.id === 'resume-all') {
    actions.resumeAll()
    return
  }
  if (command.id === 'compact-window') {
    actions.openCompactWindow?.()
    return
  }
  if (command.kind === 'role' && command.role === 'quit') {
    actions.quit()
  }
}
