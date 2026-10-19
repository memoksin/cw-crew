export type Slots = number
/** The worker key whose detail view is open; '' = the crew scene. */
export type Selected = string
/** The detail view's open tab. */
export type Tab = 'notes' | 'steps' | 'report' | 'test'

declare module 'claude-code' {
  interface PluginState {
    'cw-crew': { slots: Slots; selected: Selected; tab: Tab }
  }
}
