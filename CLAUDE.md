This is an educational app, that is meant to teach people about solar system and space objects and physics in general. It uses graphics and interaction to visualize to people, how large space is and how objects move in space.

Typical user of this app is a teacher, who wants to teach his students about the solar system and space in general. Other users of this app might be anyone fascinated by space and would like to have a visual tool to look at the amazing stuff.

This is an open source project, which is not bound by any external requirements, so anything is an option when it comes to technologies, data sources and ideas.

## Keep the help page current

The in-app help page (issue #43) lists every user-facing feature with what it is, why it is worth using, how to use it and a "try it" link. Adding, changing or removing a user-facing feature includes updating its help entry, in every locale and reading level, in the same change. A feature is not done until its help entry is.

How: add the entry (its group and a "try it" link) to `src/data/help.json` and its words to `src/locales/<locale>/help.json` in every locale, with a simple and a standard version; no code is needed. `pnpm test` (`src/features/help/help.test.ts`) and `e2e/help.spec.ts` check that every entry is complete and every link opens. See `docs/ARCHITECTURE.md`, "Help page".

## Keep the interface quiet

The solar system's screen belongs to space (issue #42). Only what you are looking at, the way out and the time stay on screen; everything else lives behind the existing entry points: Tours, Layers, Scale and Tools, the time bar's speed button, the Present menu (on a phone, More: the whole teacher's corner, #59) and a body's card. A new feature puts its controls behind one of those, never as a new permanent panel over the scene. A tool with a panel registers in the Tools menu and opens in the dock, one panel at a time; on a phone held upright the dock is one sheet from the bottom (#60), so a new panel opens in the sheet with nothing more to do (a `DockPanel`; other content marks its kind, its one-line summary and its ×, see `docs/ARCHITECTURE.md`, "The phone's sheet"). See `docs/ARCHITECTURE.md`, "HUD layout".

The same holds on a phone (issue #58). The arrangement follows the screen's size: narrower than 600 px or lower than 480 px is a phone (`@media $phone`), and wherever the main pointer is a finger every control is at least 44×44 px (`@media $touch`; both defined once in `src/utils/sizeClasses.json`). A new control says where it lives on a phone: behind the same entry points (what the corner holds on a laptop is under More on a phone), finger-sized, nothing new permanently on screen. On a touch screen a tap on the empty sky hides the controls and the next tap brings them back (#59); a feature that gives such a tap a job of its own does that job instead of hiding (`present/skyTap.ts`). Its help text names the control or the entry point, never a screen corner ("under Tools", not "bottom right"), so one text fits every arrangement.
