export type Slots = number
/** The worker key whose detail view is open; '' = the crew scene. */
export type Selected = string

declare module 'claude-code' {
  interface PluginState {
    'cw-crew': { slots: Slots; selected: Selected }
  }
}
