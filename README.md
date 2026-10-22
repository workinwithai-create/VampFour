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

- A · Chorus (bars 1–8 loop, so you can hear the missing breath)
- B · Vamp (bars 9–12 loop — the part you export)
- Full form (1–12 loop). Switch sections while playing; it lands on the next step.

## Your loop first

- BPM field (60–180), key selector (all 12 keys), and a 4-chord entry (e.g. `Am F C G`). Chords are transposed so the first chord sits on the key.
- Presets are demos. Your settings persist in localStorage and drive playback and export.
- Per-chair mutes. Changes land on the next step while playing, no restart.

## Exports

WAV and MIDI drop on the DAW grid:
- OfflineAudioContext render, 48 kHz / 24-bit stereo
- First downbeat at sample 0 (limiter lookahead and MP3 lead-in are compensated)
- Exact length `Math.round(bars * 4 * 60 / bpm * 48000)` — 92 BPM × 8 bars = 1,001,739 samples
- Ring-out tail folded onto the start for a seamless loop; peak −1.1 dBFS
- Deterministic (no randomness); reuses the samples already loaded
- Lengths: vamp 4 bars, vamp ×2 (8 bars), full form (12 bars)
- MIDI format 1: tempo + 4/4, one track per chair (piano, upright bass, nylon, trumpet, violin, kit on ch 10)

File names: `vampfour-<recipe>-<bpm>bpm-<key>.wav` / `.mid`

## Samples

PreEight bank pinned to commit `d58301e4a494555f411a2afbc448b724136eee76` (FluidR3 piano, upright, nylon, trumpet, violin; acoustic kit). 71 files preload with a visible count; if any fail the UI names the missing instruments and playback/export stay off. Multi-sampled so no note is pitch-shifted more than ±4 semitones (max used: 2). Violin holds use zero-crossing loop points with attack/release ramps.

## Pricing

Free. No price, no license key, no checkout. If it is sold later, wire a Lemon Squeezy license check first and change this line.

## License

MIT.

## Audio engine

Follows the WorkinWithAI audio rules: AudioContext-clock lookahead scheduler, one live state object, OfflineAudioContext exports on the grid, pinned samples, sustain envelopes, per-chair gain → master → DynamicsCompressor limiter, A/B loudness matched (vamp makeup gain measured offline), tap-to-start audio, stop on tab hide, iOS silent-switch note.

## Stack

Static HTML + one JS file. No build, no auth, no database.

## Play along live

Pick any VampFour voice (piano, upright bass, nylon, trumpet, violin, acoustic kit — the same pinned samples) and play it:
- **MIDI keyboard**: press *Connect MIDI* (Web MIDI permission), choose the input. Velocity and sustain pedal (CC64) work; notes sound immediately and never start the band. Optional: let MIDI Start/Stop run the band. MIDI out echoes what you play.
- **On-screen keys** (touch/mouse) and **computer keys** A W S E D F T G Y H U J K, Z/X octave, hold Space for sustain.
- **Audio output** picker (AudioContext.setSinkId, with an `<audio>` element fallback).
- **Takes**: tick *Record*, press play; each loop pass becomes a new take. Set each to Loop or Silent, mute or delete. Up to 16, saved on this device. Each take is its own MIDI track; Loop + unmuted takes are mixed into the WAV.
