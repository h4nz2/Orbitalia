# Taking part in Orbitalia

Orbitalia is free and open source, and it gets better with what teachers, students and space fans tell us. You do
not need to write code to help.

## Tell us something

- **In the app:** Help (the arrow next to it) → **Send feedback**, or [orbitalia.app/feedback](https://orbitalia.app/feedback).
  No account needed. Your message reaches the maintainers privately; your email is optional and only used to answer.
- **On GitHub:** [report a bug](https://github.com/h4nz2/Orbitalia/issues/new?template=bug.yml) or
  [suggest an idea](https://github.com/h4nz2/Orbitalia/issues/new?template=idea.yml). A link to the view where it
  happens (Share in the app, or the address bar) makes a bug much quicker to fix. Issues are public: please leave out
  students' names and other personal details.
- **[Discussions](https://github.com/h4nz2/Orbitalia/discussions):** questions ("how do I show retrograde Mars to
  my class?"), ideas that are not an issue yet, and lessons, tours and hunts you made (Show and tell).
- **Email:** [feedback@orbitalia.app](mailto:feedback@orbitalia.app).

## Help without code

- **Translations:** every word of the app is in `src/locales/<language>/`. Fixing a translation or adding a language
  needs no code (see "i18n" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)). The **simple** reading level is
  for children aged 6 to 11: no number above 100 (years included), no thousands, millions or billions, no AU,
  kelvin, m/s² or °C. Say it with comparisons instead: "11 Earths wide", "If Earth were an orange, the Moon would
  be a cherry", "hotter than an oven". `pnpm test` points at every simple line that breaks the rule.
- **Guided tours:** a tour is a JSON file; [src/data/tours/README.md](src/data/tours/README.md) explains the format.
- **Facts and stories:** the texts about each world are in `src/locales/<language>/bodies.json`; corrections with a
  source are very welcome.

## Code

1. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), the contract the app is built on, and the setup in the
   [README](README.md#getting-started).
2. Fork, work on a branch and open a pull request. Mention the issue it closes.
3. Two rules every change keeps (see [CLAUDE.md](CLAUDE.md)):
   - **The interface stays quiet:** new controls go behind an existing entry point (Tours, Layers, Scale, Tools, the
     time bar, the Present menu, a world's card), never into a new permanent panel over the scene.
   - **The help page stays current:** a new or changed feature updates its help entry in every language and reading
     level, in the same change.
4. Before you open the pull request: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, and `pnpm test:e2e`
   when the interface changed.

Everything you contribute is published under the project's [MIT licence](LICENSE).
