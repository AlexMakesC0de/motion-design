# Plan: free character voices through VoiceStudio

Date: 19 Nov 2026. Status: built the same day; tested against a stand-in VoiceStudio, not yet the real app.

## Goal

A Library character can get a voice without spending money and without
recording one. [VoiceStudio](https://github.com/debpalash/VoiceStudio) runs on
the user's own computer; Shard asks it to read the voice script in a voice the
user made there, and keeps the result like any other voice. Scenes then send it
to Seedance exactly as they do today.

## What VoiceStudio offers (from its docs, read 19 Nov 2026)

- A local server at `http://127.0.0.1:3900` once the app is open. Requests from
  the same computer need no key ([api-auth.md](https://github.com/debpalash/VoiceStudio/blob/main/docs/api-auth.md)).
- An OpenAI-style speech endpoint: `POST /v1/audio/speech` with
  `{ model: "tts-1", input, voice }` returns WAV. `voice` is `"default"` or a
  saved voice's id or name; `model: "tts-1"` uses the active engine
  ([n8n.md](https://github.com/debpalash/VoiceStudio/blob/main/docs/integrations/n8n.md)).
  `GET /v1/audio/voices` lists the saved voices.
- Voices are made in the VoiceStudio app: designed from attributes ("male,
  middle-aged, low pitch, australian accent") or cloned from a recording.
- **Bracket tags:** an engine reads a tag it doesn't know out loud. Our
  ElevenLabs script uses `[excited]`, `[whispers]` and similar, so VoiceStudio
  needs a plain script. `[pause]` works on every engine, and `[laughter]` works
  on the default one ([expressive-speech.md](https://github.com/debpalash/VoiceStudio/blob/main/docs/expressive-speech.md)).
- The first speech downloads the default model, about 2.3 GB. Without a GPU it
  still works, just more slowly.
- AGPL-3.0. Shard copies none of its code; it only calls the app over HTTP, and
  the user installs VoiceStudio themselves.

Not yet checked against a running copy: the exact shape of the
`/v1/audio/voices` reply, the health check path, and how long a 400-character
script takes on a Mac without a GPU.

## Design

### The script
- `voiceScript({ name, language, style })`: `style: "elevenlabs"` is today's
  tagged script. `style: "plain"` says the same lines without mood tags, puts
  the feeling in the words, and uses only `[pause]` and `[laughter]`.
- The panel switches to the plain script when the VoiceStudio tab is chosen,
  unless the user has written their own.

### Talking to VoiceStudio: `cli/core/voicestudio.mjs` (new)
- Address: `SHARD_VOICESTUDIO_URL`, default `http://127.0.0.1:3900`. Only
  loopback addresses are accepted, so Shard never sends a script to another
  machine and never handles a VoiceStudio key.
- `status()`: is it running, and which voices does it have.
- `speak({ text, voice })`: posts to `/v1/audio/speech` and writes the WAV into
  `runs/voices/voicestudio-<name>-<stamp>.wav`. Waits up to 10 minutes and
  can be cancelled. Errors are plain: "VoiceStudio isn't open", "that voice
  isn't in VoiceStudio", "it took too long".

### Keeping it
- The take goes through the same checks as a recording (`prepareVoice`: 2 to
  30 seconds, under 15 MB). It's stored with `origin: "voicestudio"` and the
  VoiceStudio voice name.
- Like an ElevenLabs sample, you listen first and then choose **Keep this
  voice**. The file to keep must be inside `runs/voices`.
- No kie job and no job record: it's free and local.

### Studio: the Voice panel
- Three tabs, cheapest first, each with its cost on the label:
  **Your recording · free**, **VoiceStudio · free**, **ElevenLabs · ~$0.03**.
- The VoiceStudio tab:
  - If VoiceStudio isn't running: "Open VoiceStudio on this computer", with a
    link to its download page and a Check again button.
  - If it is: a dropdown of its saved voices (plus "Default"), the plain
    script, and a **Make voice · free** button.

### MCP and CLI
- MCP: `make_local_voice` (free, local) returns the take's path; the existing
  `adopt_voice` keeps it. It's kept apart from `make_voice`, which spends, so
  free and paid tools never share a name.
- CLI: `kie voice local <asset> [--voice NAME]`, then `kie voice adopt <file>`.

### Docs
- A short **Using Shard for free** section in the README: your own recordings
  or VoiceStudio for voices, ChatGPT for character sheets, and planning and
  scene prompts. Only kie images and videos cost money.
- A line in the ROADMAP's Experimental section.

## Tests
- `voicestudio.mjs` against a fake server on loopback: running and not running,
  the voice list, a WAV reply, an error reply, a timeout, and a non-loopback
  address being refused.
- The plain script has no tags other than `[pause]` and `[laughter]`.
- Studio routes with a fake VoiceStudio; a vitest for the tab: not running,
  then pick, make and keep.
- MCP: tool count and listing.

## First real check (free)
1. Install VoiceStudio and let it download the default model.
2. Make a voice there, then use the VoiceStudio tab on a character.
3. Listen to the take. Keep it if it sounds right.

The scene that uses the voice still costs money: about $1.70 for a 10-second
draft, which needs its own OK.

## Out of scope for now
- Designing or cloning a voice from inside Shard (VoiceStudio's MCP has
  `design_voice` and `clone_voice`; worth adding once the basic path works).
- A VoiceStudio on another machine.
- Non-English scripts.
