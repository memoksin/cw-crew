// bun tools/dump.ts out.json: every reachable image frame (variant x state x frame x blink) at BIG_S hi-res pixels per pixel.
import { ALL_POSES, BIG_H, BIG_S, BIG_W, BLINKS, bigSprite, frameCount, frameFile, type Look } from '../hooks/creatures'

const out: Record<string, number[]> = { __size: [BIG_W * BIG_S, BIG_H * BIG_S] }
for (const [role, opus] of [['scout', false], ['coder', false], ['coder', true]] as const) {
  for (const state of ALL_POSES) {
    for (let frame = 0; frame < frameCount(state); frame++) {
      for (const blink of BLINKS.includes(state) ? [false, true] : [false]) {
        const l: Look = { role, opus, state, frame, blink }
        out[frameFile(l)] = [...bigSprite(l).px]
      }
    }
  }
}
await Bun.write(process.argv[2] ?? 'dump.json', JSON.stringify(out))
