export type Slots = number

declare module 'claude-code' {
  interface PluginState {
    'cw-crew': { slots: Slots }
  }
}
