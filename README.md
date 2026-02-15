# Cricket Bail Safety Trial Tools

This repository documents field trials of a tethered cricket bail safety mechanism. Each trial captures observations from a live match, practice session, or controlled test.

The goal is transparent, reproducible documentation that supports independent technical review. This project does not assert performance claims, advocate adoption, or propose changes to the Laws of Cricket.

## Related Materials

- [Defensive publication (Zenodo)](https://doi.org/10.5281/zenodo.17284396) — Technical disclosure with prior art
- [Explainer video (YouTube)](https://youtu.be/PeISNg5_usY) — Visual overview of the mechanism
- [Trial highlights playlist (YouTube)](https://www.youtube.com/playlist?list=PLcYYPWle7j_DAocfHTG9aT0MmcTBm5-Ny) — All field trial videos
- [Presentation for leagues (Google Drive)](https://docs.google.com/presentation/d/136xSsMM0RMuuDFrCSybQAT8F4PuwABc4/edit?usp=drive_link&ouid=104491509742866483855&rtpof=true&sd=true) — Overview deck for cricket leagues
- [Presentation PDF (Google Drive)](https://drive.google.com/file/d/1oVQVN1WY7dx6SvYWuCzHR1Z85Qlw31KU/view?usp=drive_link) — PDF version of the deck

## What's a Trial?

A **trial** is a documented observation session. Each trial has its own folder containing:

| File | Purpose |
|------|---------|
| `highlights.csv` | Timestamps of key moments (wickets, bail events, etc.) |
| `trial.yaml` | Metadata and written observations |
| `upload-metadata.yaml` | Info for uploading highlight videos to YouTube |
| `downloads/` | Video files (not stored in git due to size) |

Example trial folder:
```
trials/20260118-gpcc-qualifier1-dallas/
├── highlights.csv
├── trial.yaml
├── upload-metadata.yaml
└── downloads/
    ├── source.mp4
    └── highlights.mp4
```

## Trial Naming

Trials are named with the date and a short description:
```
YYYYMMDD-description
```

Examples:
- `20260118-gpcc-qualifier1-dallas` — GPCC Cup match on Jan 18, 2026
- `20260215-practice-nets-session` — Practice session on Feb 15, 2026

## Viewing Trials

Browse the `trials/` folder to see documented observations. Each `trial.yaml` contains:
- Link to the original match video
- Link to the highlight video (if uploaded)
- Summary of observations
- Detailed notes on bail events

## Creating Trials

To document a new trial:

1. **Create a folder** in `trials/` with the naming format above
2. **Add `highlights.csv`** with timestamps of key moments (see `templates/highlights.csv`)
3. **Run the highlight tool** to extract video clips (see [make_highlights.md](src/scripts/make_highlights.md))
4. **Fill in `trial.yaml`** with your observations

For technical details on the highlight extraction tool, see [src/scripts/make_highlights.md](src/scripts/make_highlights.md).

## Repository Structure

```
├── trials/           — Trial folders (one per observation session)
├── templates/        — Templates for trial files
└── src/scripts/      — Video processing tools + documentation
```

## License

- Source code: MIT License
- Documentation: CC BY 4.0

## Contact

For questions, open a GitHub Issue.
