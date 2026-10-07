# Writing a guided tour

A tour is a list of **stops**. At each stop the app shows something (a planet, the whole system, a date, a scale)
while a short piece of narration is read. The viewer or teacher moves on with **Next** (or the arrow keys, or a
presenter's clicker), can look around at any time, and comes back with **Back to the tour**.

A tour is two kinds of file, and no code:

1. **`src/data/tours/<tourId>.json`**: what the scene does at each stop.
2. **`src/locales/<language>/tours.json`**: the words, in every language the app ships (`en`, `de`).

Run `pnpm test`: `src/data/tours.test.ts` checks both files and names anything missing or misspelt. Then open
`/solar_system?tour=<tourId>` to try it (`&stop=3` opens the third stop).

## 1. The tour file

```json
{
	"id": "myTour",
	"order": 5,
	"stops": [
		{
			"id": "start",
			"view": "overview",
			"scale": "everythingVisible",
			"speed": "day"
		},
		{ "id": "jupiter", "view": "jupiter", "camera": { "distance": 1.5 } },
		{
			"id": "loop",
			"view": "earth",
			"frame": "earth",
			"fit": { "au": 2.5 },
			"select": "mars"
		}
	]
}
```

- `id`: the file name without `.json` (letters and digits only). `order`: its place in the Tours menu.
- Every stop needs an `id` (unique in the tour) and a `view`: `"overview"` (the whole system) or a body id from
  `src/data/bodies.json` (`"sun"`, `"earth"`, `"moon"`, `"europa"`, …).

Everything else is optional:

| field         | what it does                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `camera`      | `azimuth` (degrees round the plane of the planets), `elevation` (degrees above it; 89.9 looks straight down), `distance` (1 = the usual close-up, 2 = twice as far out), `light`: `"full"`, `"half"` or `"crescent"` (how the body is lit from where the camera stands; default: mostly lit), `from`: `"earth"` (stand on the Earth and look at the body in view, e.g. through a telescope), `fov` (the height of the view in degrees; below 1 is a telescope). |
| `fit`         | Frame a region instead: `{ "au": 2.5 }` (astronomical units round the centre) or `{ "km": 500000 }`; `around` names the body whose distances it is drawn like (default: the Sun for `au`, the body in view for `km`).                                                                                                                                                                                                                                           |
| `move`        | `"fly"` (the flight with its distance readout; the default between two bodies), `"glide"` (the default otherwise) or `"jump"`.                                                                                                                                                                                                                                                                                                                                  |
| `time`        | Travel to `{ "date": "2025-01-16" }` (noon UTC), `{ "moment": "moonLanding" }` (a moment of `src/features/solarSystem/ui/moments.ts`), `{ "event": "solar2024" }` (a sky event of `src/data/skyEvents.json`, at the instant the app shows it best) or `"now"`.                                                                                                                                                                                                  |
| `speed`       | `"paused"`, `"realTime"`, `"minute"`, `"hour"`, `"day"`, `"week"`, `"month"`, `"year"` or `"decade"` (per second).                                                                                                                                                                                                                                                                                                                                              |
| `scale`       | `"everythingVisible"`, `"textbook"`, `"bigPlanets"` or `"trueScale"`. The switch is animated, so the class sees it happen.                                                                                                                                                                                                                                                                                                                                      |
| `layers`      | Switch `orbits`, `labels`, `moons`, `markers`, `orbitNames`, `allMoons` (every small moon, not only the featured ones) on (`true`) or off (`false`).                                                                                                                                                                                                                                                                                                            |
| `frame`       | Hold the body in view still (Seen from Earth): the planets draw their paths around it. Only for this stop.                                                                                                                                                                                                                                                                                                                                                      |
| `trails`      | With `frame`: `"restart"` lets the paths grow from this stop's date, `{ "since": "2024-10-01" }` from that day.                                                                                                                                                                                                                                                                                                                                                 |
| `select`      | The body to select (its card, its name in orange). Default: the body in view; `null`: nothing.                                                                                                                                                                                                                                                                                                                                                                  |
| `follow`      | Ride along with a spacecraft (`"voyager1"`, an id of `src/data/spacecraft.json`): the camera follows it while time runs and its card opens; `view` names the body whose neighbourhood it is in, and `camera.distance` counts in millions of km as drawn. Only for this stop.                                                                                                                                                                                    |
| `link`        | `"solarWalk"` adds a button to the basketball walk.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `autoSeconds` | With autoplay on, how long to stay (default: long enough to read the narration aloud).                                                                                                                                                                                                                                                                                                                                                                          |

`speed`, `scale` and `layers` **carry forward**: they stay until a later stop changes them, so set them where the
lesson changes, not at every stop. A `time` is travelled to when its stop is reached. `frame`, `select` and
`follow` belong to their own stop only.

## 2. The words

In `src/locales/en/tours.json` (and the same keys in every other language):

```json
"myTour": {
	"title": "My tour",
	"summary": "The question this tour answers, in one sentence.",
	"stops": {
		"start": {
			"title": "Where we begin",
			"text": {
				"simple": "For ages 8 to 11: short sentences, things a child can picture.",
				"standard": "For ages 12 to 15. Every text needs at least this one.",
				"advanced": "For 16 and up: the numbers and the names of things."
			}
		}
	}
}
```

- Every text is either one string for all reading levels or one per level (`standard` is required).
- A stop with a `link` also needs a `link` text: the label of its button. Name the idea, not the page
  ("Shrink the Sun to a basketball and walk the solar system", not "Solar walk").
- Two to four sentences per stop. Say what to look at on screen and why it matters; one number people can
  picture beats five they cannot. Check every fact: this is used in classrooms.
