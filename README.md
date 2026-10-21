# VampFour

Four-bar live vamp desk for bedroom producers and AI-music finishers.

Generators loop the chorus or mute to silence for a "vamp".  
Session players write four live bars of pedal, figure, and half kit so the song can breathe or hand off.  
Then the next section returns.

Live samples only — FluidR3 acoustic grand, upright bass, nylon guitar, trumpet, violin, and acoustic kit from the PreEight bank (pinned to commit `d58301e4a494555f411a2afbc448b724136eee76`).  
No oscillators. Audio never leaves the tab.

## Distinct from yesterday and the rest of the line

| Tool | Job |
| --- | --- |
| TagFour | Four-bar last-line tag after the money chorus |
| LiftTwo | Two-bar pre-hook lift |
| PreEight | Eight-bar musical pre-chorus |
| AfterHook | Eight bars after the hook |
| EndEight | Last eight bars of the record |
| LastHook | Money last chorus |
| ModEight | Last-chorus key change |
| **VampFour** | Four-bar vamp so the track can breathe or hand off |

Yesterday's ship was TagFour (last-line end tag).  
VampFour is the middle-section breath — not an ending, not a climb, not a density stack.

## Form

1–8 chorus pocket · 9–12 vamp · (next section returns on 13)

## Play

- A · Loop (chorus only, so you can hear the missing breath)
- B · Full form (chorus + vamp, then stop)
- 8 · Vamp only (for the export you drop on bars 9–12)

## Pricing recommendation

**One-time $29** on Lemon Squeezy (merchant of record).  
Mirror on Gumroad for the producer crowd.  
Do not subscribe; this is a finite desk, not a cloud meter.  
Forge Pass stays the $24 bundle for the recurring tools.

Best place to sell: Lemon Squeezy primary, Gumroad secondary, pinned X demo + r/WeAreTheMusicMakers / Product Hunt post.

## License

MIT.  
Free to use. No license gate.  
If a priced build is later required, add a Lemon Squeezy key check or WorkinWithAI entitlement before calling it paid.

## Audio engine

Follows WorkinWithAI rules: AudioContext clock lookahead scheduler, live state, OfflineAudioContext exports on the grid (first downbeat at sample 0, exact length, tail folded), pinned samples, sustain envelopes, master compressor, visibility stop, localStorage persistence.

## Stack

Static HTML / CSS / JS.  
Deploy on Vercel team `release-forge`.
