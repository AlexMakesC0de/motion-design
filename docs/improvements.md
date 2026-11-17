# Improvements

Agreed with Alex on 2026-11-17, after the camera and look pickers for Scenes shipped. In the order they should be done. Tick an item when it is merged into `main`.

- [ ] **1. Pickers on Create Video.** The Move, Shot size, Angle, Lens and Lighting chips exist only in Scenes. Put the same row under the prompt box on Create Video, and give `kie video --pick` and the MCP `generate_video` tool the same option. Designed in [the pickers spec](superpowers/specs/2026-11-17-camera-look-pickers-design.md#on-create-video).
- [ ] **2. Make the price shown match the price charged.** Per-second prices are already in `cli/models.json` for most video routes (read from kie on 2026-10-30). What is left: re-read the live pages, price the routes that still use one flat figure, and count the billing rules the estimate ignores (a reference video on Seedance, audio on Kling).
- [ ] **3. Say when ffmpeg is missing or broken.** Check once at startup and show which steps are off and how to fix it, instead of failing after takes are paid for.
- [ ] **4. Silent and Loop switches on a take.** Strip the audio Seedance adds even when asked for silence, and find the loop cut, without doing either by hand.
- [ ] **5. A preview for each pick.** A short clip or still beside each option in a chip's list. Costs credits once per option (about 60).
- [ ] **6. Warn when typed words contradict a chip.** For example "pull out" typed under a Push in chip.
- [ ] **7. Keep an agent from wiping stage picks.** When `save_scene` resends a scene's stages without their picks, keep the picks unless told to remove them.
- [ ] **8. Safety nets for the code.** An `npm run typecheck`, a GitHub check on every push, and a fix for the page test that fails now and then (`useScenes.test.ts`, "a job event for one of its versions reloads").
- [ ] **9. The bigger Higgsfield gaps.** After-the-take tools (upscale, extend, lip-sync), a larger look library, a product-ad builder, a chat director in the studio. Each is its own project.
