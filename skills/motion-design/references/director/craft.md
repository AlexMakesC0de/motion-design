# Craft: shot sizes, angles, lenses, moves, light, cuts

Read this before you plan any shot list. The film-type chapters ([product-ui](product-ui.md), [live-action](live-action.md), [character](character.md), [product-hero](product-hero.md)) assume it, and [brief](brief.md) comes first.

## How to use this chapter

Every shot picks its size, angle, lens, depth, move, light and cut from the menu. The labels below are the menu's labels; the id in backticks is what goes in `shots.json`. Code refuses anything off the menu. This chapter is the reasoning behind each choice.

Decide in this order: what the shot is for, then size, angle, lens and depth, then the move, the light, and how it cuts to the next shot. Size carries most of the meaning. Everything else tunes it.

Two facts about this pipeline shape every choice.

**The words steer, they do not guarantee.** A menu choice reaches the video model as plain language. "85mm portrait lens" does not make the model use optics. It makes a close-up that looks like an 85mm one more often. The still is where you see whether the language landed, before the video is paid for.

**Every shot starts as a still.** The still fixes size, angle, lens, depth, light and who is in frame. The video adds the camera move and the action. So `action` says what changes from the still, not what the still already shows. One camera move per shot, and the move field holds it. Never hide a second camera move in the action.

## Shot sizes

Size is how much of the subject the viewer sees, and so how close they feel. One step at a time (wide, medium, close-up) feels like walking in. Two steps feels like a decision. The same size from the same angle twice in a row looks like an error, and three of one size in a row gets a warning.

**Extreme wide** `extreme-wide`. The subject is a speck in a large place. It shows how small the subject is and what world it lives in. Use it to open a film or a new place, or to close on isolation. Give it 4 seconds or more. Avoid it when the viewer must read a face, a label or a screen: at this distance a model cannot hold detail, and identity drifts.

**Wide** `wide`. The place and where everyone is. This is the establishing shot: geography first, then closer. Keep depth deep and the subject easy to find. A wide with small faces is a place shot, not a character shot.

**Full** `full`. Head to toe: posture, a walk, costume, how a body sits in space. Good for entrances, exits and 9:16, where a standing figure fills the frame. Leave air above the head and below the feet. Cropping at the ankles looks accidental.

**Medium wide** `medium-wide`. Knees up. A person with what their hands and surroundings are doing: cooking, typing, carrying. Use it when the hands matter. Step in when you only want the face.

**Medium** `medium`. Waist up. The neutral, conversational shot: face and gesture without pressure. A film made only of mediums has no rhythm.

**Two-shot** `two-shot`. Two people in one frame, usually knees or waist up. It shows a relationship: who stands close, who turns away. Use it before cutting to singles, and come back to it when the relationship changes. Keep both faces at a similar size and on their own third; a two-shot where one person is cut off reads as an accident.

**Medium close-up** `medium-close-up`. Chest up. A reaction with a little context left. The workhorse for a person thinking, listening or speaking: the face is big enough for identity and expression, and the shoulders and a hint of background stay in frame.

**Close-up** `close-up`. A face or an object fills the frame. Emotion and decisions live here, and so does the object the story turns on. One expression change per close-up. Pair it with a longer lens. Do not hold it past 3 or 4 seconds unless something changes.

**Extreme close-up** `extreme-close-up`. An eye, a fingertip, a texture. Maximum intensity, so one or two per film. On products it is texture. Avoid it for identity: at this scale the model invents fine detail.

**Insert** `insert`. A detail the viewer must read or notice: a button, a label, a screen, a key in a lock. It is defined by its job, not its distance. Frame only what has to be read and hold it long enough to read (see Pacing). Anything that must be legible word for word is a code render, not a generated insert. See [product-ui](product-ui.md).

## Angles

Angle is where the camera sits compared with the subject's eyes, and it says something about power. Stay consistent: a character shot low when strong should not be shot low when helpless.

**Eye level** `eye-level`. Neutral and honest; the viewer becomes a peer. Most shots in most films should be eye level. Every other angle gets its force from being the exception.

**High** `high`. The camera looks down. The subject is smaller, overwhelmed or watched. Also the natural overview of a layout. A film shot from above makes everyone look weak.

**Low** `low`. The camera looks up. The subject gains height and power: an arrival, a hero, a product as a monument. On faces use 35mm to 85mm so the chin and nostrils stay flattering.

**Overhead** `overhead`. Straight down. People become pattern: a desk, hands working, food, a layout, a screen treated as a graphic. Faces from straight above read oddly. Pair it with deep focus and front or top light.

**Worm's eye** `worms-eye`. From the floor. It exaggerates scale and drama: a building looms, a product towers. Once per film at most. Avoid it on faces.

**Dutch** `dutch`. A tilted horizon for unease or energy. Use it rarely and never in two shots in a row. In calm or premium films it reads as a mistake.

**Over the shoulder** `over-the-shoulder`. Past one person at another person or at a screen. It puts the viewer in the scene and links two things. Keep the foreground shoulder dark and soft at the frame edge, and the same shoulder for the whole scene (see Continuity). The foreground person is seen from behind, so their face matters less.

**Point of view** `point-of-view`. What the subject sees. It needs a setup: show the person looking first, or the viewer does not know whose eyes these are. Good for discovery and first-person moments. Avoid showing the subject's own face. Hands in frame are fine.

## Lenses

Focal length changes how much of the world fits, how far apart near and far things look, and how faces look. Short lenses stretch space; long lenses squeeze it and bring the background near. The size you chose pulls the lens with it: wide sizes sit with 24mm to 35mm, mediums with 35mm to 50mm, close-ups with 85mm.

**14mm ultra-wide** `14mm`. Exaggerated space and energy: tight interiors, a low hero angle on a product, a move that should feel fast. Straight lines bend at the edges. Never on a face up close: noses balloon. Avoid it near a screen you want square.

**24mm wide** `24mm`. Roomy and close at once. The establishing lens, and good for moving through space because a move shows plenty of parallax. People near the edges stretch, so keep faces out of the corners. Avoid it on close-ups of faces.

**35mm** `35mm`. Natural and documentary. The storyteller's all-rounder, safe for walking, medium wide shots and over-the-shoulder frames.

**50mm** `50mm`. Close to how the eye sees. Honest medium shots with no drama in the perspective. Choose it when the picture should feel neutral: a conversation, a person at a screen.

**85mm portrait** `85mm`. Flatters faces, compresses features and melts the background. Close-ups and medium close-ups, almost always with shallow focus. If a face matters, this is the lens.

**135mm telephoto** `135mm`. Compresses the background so far things stack up behind the subject, and isolates. It feels like watching from afar: a runner against a crowd, a figure at the end of a street. Avoid it for intimacy or a spacious feel.

**100mm macro** `100mm-macro`. Tiny details, large and sharp: texture, product surfaces, UI pixels, an eye. The plane in focus is very thin, so say what is sharp. Pair it with an extreme close-up or an insert.

### Lens look

Pick one lens look for the whole film, in `look.lensFamily`. Mixing two reads as two films.

**Clean sharp** `spherical`. A clean modern image with round bokeh. The default for tech, product, UI and anything that must feel precise.

**Anamorphic** `anamorphic`. A cinematic widescreen feel with oval bokeh and horizontal flares from bright lights. It suits night, neon and drama, and works best in 16:9 and 21:9. Not for vertical frames or films where clean UI is the star.

**Halation vintage** `halation-vintage`. Old glass whose highlights glow and bloom into the dark around them. Dreamy and nostalgic: night streets, candlelight, skin in backlight. Too soft for UI or text.

**Warm vintage** `warm-vintage`. More a colour grade than a lens, so the studio's Camera popup leaves it off the Lens wheel (it belongs with colour palettes); Looks and the AI can still use it. Warm, low-contrast vintage glass that forgives skin and softens edges. Memories, lifestyle and food. Not for crisp product detail.

**Vintage anamorphic** `vintage-anamorphic`. Seventies anamorphic glass: blue streak flares, oval bokeh and soft corners. Period drama and music videos; like anamorphic, keep it to wide frames.

## Camera bodies

What the picture was recorded on sets its grain, colour and texture before any lens or light. A plain video can pick one (the `camera` pick in the studio and `kie video --pick`); a planned film keeps this in its look's film look.

**DV camcorder** `dv-camcorder`. A 2000s consumer camcorder: soft detail, video noise and clipped highlights. Home video, found footage and Y2K nostalgia.

**8mm film** `8mm-film`. Grainy Super 8 with gate weave and faded warm colour. Memories, travel diaries and dreamy montages; never for a product that must look sharp.

**35mm film** `35mm-film`. Fine grain and rich natural colour: the default "this was filmed" look for drama and fashion.

**Modern** `digital-cinema`. A modern digital cinema camera, clean and sharp. Commercials, tech and products.

## Depth of field

Depth of field is how much of the picture is sharp. It follows from aperture, and also from lens and distance: a closer subject and a longer lens make focus thinner. Use it to decide what the viewer looks at.

**f/1.4 Wide open** `shallow`. Shallow depth of field. One plane sharp, the rest soft. It isolates the subject and hides a messy background, which is also why models like it. Use it for close-ups, faces and product beauty. Avoid it on wides and on screens that must read: soft edges on a screen look like a mistake.

**f/4 Medium** `medium`. Medium depth of field. The subject is sharp and the surroundings stay readable. The right default for a person in a place, because the place still tells the story.

**f/11 Deep focus** `deep`. Deep focus, f/8 to f/11. Everything sharp. Wide shots, graphic layouts, screens and flat lays. Avoid it on a portrait close-up unless you want a documentary feel. A deep shot shows everything, so check that everything in the still is worth showing.

## Camera moves

A move earns its place when it reveals something, builds attention, follows someone or changes the viewer's relationship to the subject. If the shot works with a still camera, leave it still. Each shot gets one move and one speed; what the subject does belongs in `action`.

**Speeds.** **Creep** is barely perceptible: the frame seems to breathe. It suits product hero, tension and long holds, and it is the safest speed for a model, but on a short shot it can read as no move at all, so give it 5 seconds or more. **Slow** is calm, premium and the most reliable for video models. **Medium** is purposeful and neutral. **Fast** brings energy and urgency but needs room: in a shot of 4 seconds or less it rarely reads, because the viewer has no time to see where it lands. Give a fast move 5 seconds or more and a beat of rest at the end. The edit trims the first half second of every take, so keep the key moment out of it.

**Static shot** `static` (typed #static-shot). The camera holds still. The right choice for a face, a reveal inside the frame, a held payoff and any shot with text coming on top. It still needs a strong frame.

**Dolly in** `push-in` (typed #dolly-in). The camera moves toward the subject, so perspective and parallax change. It builds attention or a realisation. Land on something worth landing on, and use slow for emotion. Do not push in on nothing.

**Dolly out** `pull-out` (typed #dolly-out). The camera moves away to reveal context or close a scene. It works when the wider frame says something the tight one hid, such as that the character is alone.

**Pan left** `pan-left` and **Pan right** `pan-right`. The camera stays fixed in one spot, straight across from the subject, and only rotates, with no travel and no parallax. A pan is named by the way it rotates: pan left starts turned to the right of the subject, where they are out of frame, and rotates left until they sit in the centre; pan right starts turned to their left and rotates right. Always end a pan on something. If the near and far objects shift against each other, the camera travelled: that is a slider or a truck, not a pan.

**Tilt up** `tilt-up` and **Tilt down** `tilt-down`. The camera turns up or down on the spot. Tilt up reveals height or lifts the mood: a tower, a figure from boots to face, a stem rising to a bloom. For a figure, set the camera below waist height pointing at the ground, with their feet just entering the top of the frame, then tilt up without the camera rising so they are revealed from below. Tilt down brings the eye to what matters. To lift the whole camera instead, use a pedestal.

**Truck left** `truck-left` and **Truck right** `truck-right`. The subject leads and the camera catches up. The subject faces the camera, turns to the side and starts walking while the camera still holds, drifting off centre; then the camera slides sideways after them, slowly catching up until they are back in the centre. Near and far things shift at different rates, which gives depth. If the camera moves with the subject from the first frame, dead centre, that is side tracking.

**Pedestal up** `pedestal-up` and **Pedestal down** `pedestal-down`. The camera lifts or sinks straight, without tilting. Rise to reveal over an object or a wall; sink to land on a detail. Smaller and calmer than a crane.

**Tracking** `follow` (typed #tracking). The camera stays with a moving subject at a constant distance, so the subject holds its place in the frame while the world streams past. Use it for a walk, an arrival or a chase, and give the subject a screen direction. Avoid pairing it with fast subject motion: models blur and warp.

**Arc left** `orbit-left` and **Arc right** `orbit-right` (typed #arc-left, #arc-right). The camera circles the subject to show it in the round. Keep the arc under 45 degrees; wider arcs make some models rebuild the subject. For a full turn, let the subject rotate on a turntable with a static camera, or cut between two shots from different sides. Use slow.

**Crane up** `crane-up` and **Crane down** `crane-down`. A big rising or descending move. Crane up starts at the subject's waist height with their full body in frame, then rises steadily up and back along a curve, tilting down to keep them centred, until it looks down on them from far above; you should clearly see the camera pulling away. Crane down is the same path in reverse. Give it 6 seconds and a tall space with no ceiling in the way. Models handle the descent better from a high first frame, so one Crane down clip played backwards also makes the Crane up. It suits openings and endings and shows scale. Crane down descends into a scene from above and delivers the viewer to the subject. It wants a wide lens, a big space and at least 4 seconds. Not for small rooms or short shots.

**Handheld** `handheld`. A slight natural shake. Immediacy: creator footage, documentary, a moment that feels caught. Models tend to overdo the shake, so keep the action simple. Not for premium products, UI, or any shot that should feel precise.

**Slow zoom in** `zoom-in` and **Slow zoom out** `zoom-out` (typed #slow-zoom-in, #slow-zoom-out). The picture is magnified or shrunk without the camera moving, so perspective stays flat. A deliberate, graphic emphasis. On a flat screen it looks almost the same as a push in; on a three-dimensional scene a push in gives richer depth, so prefer it there.

**Dolly zoom** `dolly-zoom`. The camera pushes in while the lens zooms out, so the subject holds its size and the background stretches behind it. The classic "the floor drops away" moment of realisation or dread. Once per film at most, on a held subject with depth behind it. Models render it unreliably; if the still and take do not show the stretch, use a slow push in instead.

**Aerial** `aerial`. The camera flies over the scene from high above, like a drone. Geography at scale: a coastline, a city, a route. Open or close a film with it, at slow or creep speed. Faces are invisible at this distance, so never ask an aerial to carry identity.

**Rack focus** `rack-focus`. The camera holds still and the focus shifts between two planes: the subject on one side of the frame, and an object close to the lens on the other, such as a pillar, a wall edge or a stem of grass. The subject starts sharp, then the focus pulls to the near object, which sharpens as the subject melts into blur. Give the subject a little life, like a gentle sway, so the blur reads as focus and not as a frozen picture. It needs shallow depth and clearly separated planes. The video has to change which plane is sharp, which models do unreliably, so keep a plan B: two shots cut together.

**Side tracking** `side-tracking`. The camera moves sideways exactly with a walking or running subject from the first moment, keeping them in profile dead centre while the background streams past. Give the subject a clear screen direction and keep the speed steady. If the camera starts late and catches up, that is a truck.

**Slider left** `slider-left` and **Slider right** `slider-right`. The camera starts on the subject and glides smoothly sideways, slider right to the right and slider left to the left, so near pillars pass with parallax and the subject slides out of the other side of the frame. Smaller and smoother than a truck. Products, details, calm portraits or an exit; the parallax of a near object sells it. A clip that slides onto the subject can be played backwards to make one that slides away.

**Snorricam** `snorricam`. The camera is strapped to the subject's waist, facing up at them, and frames them from the waist up as they walk. It is part of their body: each step jolts and shakes it, and when they turn to look left or right the camera pivots the same way, so the world lurches and swings behind them while they stay pinned in the frame. Use it for panic, drunkenness or determined resolve. Keep it short: over a long take models drift the face. A smooth camera gliding in front of them is a tracking shot, not a snorricam.

**Robot arm** `robot-arm`. A motion-control rig moving in precise beats, close to the subject the whole time. It starts at their feet and swirls up and around them at a steady, unhurried pace, easing back a little as it goes, until it faces them, and pauses. Then it pivots up and over to look down on their head from above, and pauses again. Each move is smooth and exact, never rushed, and each pause is dead still: the stops make it read as a machine, and without them it is just an arc. Start from a close, feet-level frame, because the model cannot invent the low start. Give it 6 seconds or more for two moves and two holds. Use it for high-energy product and fashion hero moments, and keep the subject simple so it survives the moves.

**POV** `pov`. The camera is the subject's own eyes. Puts the viewer inside the character: walking, reaching, looking around. Show their hands or feet so it reads as first person. (The POV angle frames a shot; this moves it.)

**Whip pan** `whip-pan`. A fast blurred pan that snaps attention somewhere new. Energy and transitions; pairs with a whip cut to the next shot.

**Crash zoom** `crash-zoom`. A sudden fast zoom from a wide view onto the subject's face that eases to a stop with their eyes dead centre, then holds. The stop on the eyes is the point. Comic or dramatic emphasis: a reaction, a reveal. Once is a joke; twice is a style.

**Bullet time** `bullet-time`. The camera faces the subject as they jump, legs folding naturally, hair flying. At the top of the jump everything freezes in mid-air: hair, clothes and body hang still. Hold the frozen moment for a good second, then the camera circles around them, close, while nothing in the scene moves. Give it 6 seconds: a jump, a hold and a circle.

**Drone orbit** `drone-orbit`. The camera circles from high above, showing a lone figure or a place inside its landscape. Slow or creep speed.

**Helicopter shot** `helicopter`. High, fast flight over the landscape. Epic scale to open a film over a city, a coastline or mountains. Like aerial, it never carries a face.

**Aerial pullback** `aerial-pullback`. The camera pulls back and rises into the sky, leaving the subject small below. Closes a film: the character alone in a big world.

## Lighting

Light sets mood, time and place, and tells the eye where to look. Two rules hold for every setup.

**Motivated light.** The light should seem to come from something in the world: a window, a lamp, the sun, a screen, a sign. Light with no visible reason looks fake. A source in frame is a practical.

**One key side.** The key light is the main light. It sits left, right, front, back or top of the frame, and `look.keyLightSide` holds it for the film. Changing the side between shots makes faces and objects look different across the cut. If it must change, because the subject turned or moved to another room, write the reason in `lightReason`.

**Left** `left` and **Right** `right` model the face and give depth; light from the side the subject is turning toward is flattering and a little dramatic. **Front** is flat and even, good for graphics and beauty. **Back** gives silhouettes and rims. **Top** suits product tables and drama.

**Soft high key** `soft-high-key`. Bright, even, little shadow. Friendly, clean, optimistic: tech, lifestyle, mascots. With little shadow there is little depth, so build depth with composition and lens. Avoid it for drama or mystery.

**Low key** `low-key`. Few lights, deep shadows. Drama, night, mystery, luxury. Keep one shaped highlight on the subject or the model crushes everything to black. Not for anything friendly, or a product that must be seen clearly.

**Rembrandt** `rembrandt`. The key sits about 45 degrees to the side and above, leaving a small triangle of light on the shadowed cheek. Classic portrait depth, for faces in close-ups and medium close-ups. Not for wides, where the face is small, or a subject who keeps turning, because the triangle breaks.

**Backlit rim** `backlit-rim`. Light from behind traces the edge of the subject. It separates subject from background, adds a hair light and makes silhouettes. On a face, add a soft fill or the face goes dark. On products and glass it draws the shape.

**Window light** `window-light`. Soft daylight from one side through a window. The usual key for real-looking interiors: it models a face gently and explains itself. The window side is your key side, so keep it there for the whole scene. Avoid it at night unless the window is dark and practicals take over.

**Golden hour** `golden-hour`. Warm, low sun with long shadows. Warmth, nostalgia, hope. The sun is the key, so its direction is your key side and must hold through the scene. Indoors it needs a window to explain it.

**Night with practicals** `night-practicals`. Lamps, signs and screens in frame are the light, and it looks real because every source is visible. A face lit by a laptop is cool and blue; a lamp is warm. Keep the sources the same shot to shot: a lamp in one frame and gone in the next breaks the room.

**Studio product** `studio-product`. A large softbox for soft reflections plus a rim light for crisp edges. It gives glossy surfaces clean gradients and objects clean outlines. Use it for products. Not for people or natural scenes.

**Neon** `neon`. Saturated coloured light, often two colours from opposite sides. Nightlife, gaming, energy. Avoid it where true colour matters, such as a product whose colour is the point.

**Blue hour** `blue-hour`. Just after sunset: cool blue sky with warm practical lights coming on in windows and streets. Calm, wistful, cinematic, especially for cities and coasts. It lasts minutes in life, so hold it across the scene; a cut from blue hour to daylight breaks continuity.

**Overcast natural** `overcast`. Soft daylight, no hard shadows. Natural and gentle, flattering to faces, the look of documentary. Wides with a blank sky can look dull. Not for drama or glow.

**Hard midday sun** `hard-sun`. High sun, crisp short shadows, strong contrast. Heat, summer, sport and energy, and graphic shadow shapes. It is unkind to faces (squints, dark eye sockets), so keep people in wides or turned into shade for close-ups.

The film's palette and grade sit in `look`. Keep colour temperature consistent between shots, or they read as separate films.

## Composition

Place the subject on purpose.

**Thirds.** Put the subject, or the eyes, near a third line rather than dead centre. Centre when you want formality or symmetry, such as a product packshot.

**Headroom.** Leave a modest gap above the head. Too much makes the person look small, too little feels cramped. Never cut at the neck, wrists, knees or ankles. Crop between joints.

**Lead room.** Leave space in front of a face or a travelling subject, in the direction they look or move. A person looking right needs room on the right. A subject with no room ahead feels trapped, which suits some stories.

**Negative space.** Empty frame gives the eye a rest and gives a title somewhere to go. The film's `copy` is drawn by code over the footage, so plan a quiet area for it in the still: plain wall, sky, a soft background. Avoid putting text on busy texture.

In 9:16 stack the subject high and leave the bottom clear, because platform interfaces cover the edges. In 21:9 use the width: put the subject at one side and let the space speak.

## Cuts

The `cut` on a shot is how that shot hands over to the next. The last shot has no next shot, so give it `hard`, or `fade-out` to end on black.

**Hard cut** `hard`. The default change of view. Cut when something new needs to be seen, end the shot on a completed beat, and start the next at a different size or angle. Most cuts in a good film are hard cuts.

**Cut on action** `on-action`. Cut mid-movement so the motion hides the edit. End this shot with the movement underway (a hand reaching, a turn beginning) and start the next with the same movement happening from a new size or angle. Good for entrances, grabs, turns and sits. Avoid it when the action has finished by the end of the shot, because there is nothing to hide the cut behind.

**Match cut** `match`. A shape, position or motion at the end of this shot matches one at the start of the next: a round button becomes a clock, a swinging door becomes a closing lid. Put the matching element at the same place and size in both stills, and match one thing, not three. Avoid it when the match needs the model to transform something mid-shot. Let the cut do the transformation.

**Whip pan** `whip`. A fast blur carries the energy into the next shot. It works between places or ideas where the story speeds up, and the blur should travel the same way at the end of one shot and the start of the next. Once or twice at most. Not for calm films, conversations, or over screens the viewer must read.

**Jump cut** `jump`. A cut within the same framing that skips time. As a mistake it looks like a glitch; as a choice it is the energy of creator and UGC footage, or a way to compress a wait. Choose it on purpose and the checker stops warning about the matching frames.

**Dissolve** `dissolve`. One picture melts into the next over half a second to a second. It tells the viewer time has passed or the mood is shifting softly. Avoid it as a default: a dissolve between two similar frames looks like a glitch, and a film of dissolves feels slow.

**Fade to black** `fade-out`. The picture fades to black. It ends a film or a chapter, or clears the screen before a title. Use it on the last shot, or once before an end card; a fade in the middle of a short film reads as the end.

**Continuous** `continuous`. The next shot starts on this shot's last frame: one unbroken moment. Use it when the picture must carry straight on, such as a push in that ends on a face which then changes expression. The next shot's own still was only a preview, so plan its size, angle, lens, depth and light to match where this one lands. Keep chains short: identity and light drift a little at every join. Avoid it on the last shot, and wherever a hard cut would do.

## Continuity

Continuity means that what the viewer sees in one shot is still true in the next.

**The 180-degree line and screen direction.** Picture a line through two people, or along a subject's path. Keep every camera on one side of it, so a subject who travels left to right keeps travelling left to right across cuts. Flip it and the viewer thinks the subject turned around. To cross the line on purpose, put a head-on or tail-away shot (`toward-camera` or `away-from-camera`) between, or make a visible move across the line, and record the reason in `crossesLine`.

**Eyelines.** If one person looks toward frame right, the person they look at looks toward frame left, at the same height. Singles and over-the-shoulder shots follow the same rule. A person looking at a screen looks at it from the same side in every shot.

**Light direction.** One key side, one time of day, the same practicals. If the sun is on the left in the wide, it is on the left in the close-up.

**Everything else that carries over.** Costume, hair, props in hands, what is on a screen, time of day, weather. The casting sheet and the still carry identity, and the Library descriptions go in word for word, so never describe a character or product a second way.

**The 30-degree rule and jump cuts.** Two shots of the same subject need a real difference: change the angle by at least 30 degrees, or the size by two steps (medium to close-up, not medium to medium close-up). Anything less reads as a jump cut, where the subject seems to twitch. Jump cuts can be a style, as in creator footage, but never an accident.

## Pacing

A shot should last long enough to finish one beat and be understood, and no longer. A move or an action cannot start and finish in under about 2 seconds, and models drift when a shot runs past 6 to 8, so plan shots of 2 to 6 seconds and split anything longer.

Rough lengths: an establishing wide 3 to 5 seconds, a medium 2 to 4, a close-up 2 to 3, an insert 1.5 to 3, a held payoff 3 to 5. Reading takes about 3 words a second plus a beat of rest, so a five-word line needs close to 3 seconds.

Build the film in three moves. **Establish**: where we are and who is here. **Detail**: the thing that matters, in closer shots. **Payoff**: the result or feeling, held a little longer than the rest. Even a 10-second film follows this. Vary the sizes, tighten the rhythm toward the climax, and end on a held frame.

A fast move needs time to read. The edit drops the sluggish start of each take, so action that must be seen belongs in the middle of the shot.

The shots must add up to the brief's length within a second, end card included.

## Quick recipes

- Calm, premium: `slow` Dolly in, 85mm portrait, Shallow (f/1.4-2), Soft high key.
- Heroic arrival: Low angle, 35mm, `slow` Tilt up, Backlit rim or Golden hour.
- Intimate reaction: Close-up, Eye level, 85mm portrait, Rembrandt, Static shot, one expression change.
- Establishing a place: Wide, 24mm wide, Deep (f/8-11), Crane down.
- A detail to read: Insert, 100mm macro, Medium (f/4), Static shot.
