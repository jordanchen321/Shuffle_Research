# Shuffle Research

Research project studying wash card shuffle mechanics — specifically how individual cards move through a deck across repeated wash shuffle trials.

## Setup

**First time only:**

```bash
cd csv-card-editor
npm install
npm run vision:deps
```

`vision:deps` creates the card-vision Python venv and installs core requirements (ultralytics, opencv, numpy, etc.). Requires Python 3 on your PATH.

**If the vision server fails to start** (missing uvicorn/fastapi error):
```bash
cd card-vision
.\env\Scripts\pip install uvicorn fastapi pydantic  # Windows
# or on macOS/Linux:
./env/bin/pip install uvicorn fastapi pydantic
```

**Every time after that, run:**

```bash
cd csv-card-editor
npm run dev
```

Starts the CSV editor at http://localhost:3000 and the card-vision backend at http://127.0.0.1:8787.

To test the vision server independently:
```bash
cd card-vision
.\env\Scripts\python main.py  # Opens camera with live detection
# or in another terminal:
python -m uvicorn server:app --host 127.0.0.1 --port 8787  # Starts API server
```

---

## Troubleshooting

**"No module named uvicorn" when starting vision server:**
- The server dependencies weren't installed by `vision:deps`
- Fix (Windows): `cd card-vision && .\env\Scripts\pip install uvicorn fastapi pydantic`
- Fix (macOS/Linux): `cd card-vision && ./env/bin/pip install uvicorn fastapi pydantic`

**"No module named ultralytics" or other missing packages:**
- Reinstall core dependencies:
- Windows: `cd card-vision && .\env\Scripts\pip install ultralytics opencv-python-headless numpy torch torchvision`
- macOS/Linux: `cd card-vision && ./env/bin/pip install ultralytics opencv-python-headless numpy torch torchvision`

---

Each row in the CSV represents one card in one trial:

| Column | Description |
|---|---|
| `name` | Researcher name |
| `sequence_id` | 10-character ID grouping a set of consecutive trials |
| `trial_id` | Trial number within the sequence (1, 2, 3 …) |
| `card_number` | Card key: rank + suit letter — `AS`, `10H`, `KD`, `2C` |
| `start_position` | Card's position before the shuffle (1 = bottom of deck) |
| `end_position` | Card's position after the shuffle (1 = bottom of deck) |

---

## Card Vision (`card-vision/`)

YOLOv8 model detecting 52 cards, 2 jokers, and the card back.

| Variable | Default | Description |
|---|---|---|
| `CARD_VISION_MODEL_PATH` | `./model-output/weights/best.pt` | Path to model weights |
| `CARD_VISION_IMGSZ` | `960` | Inference image size (multiple of 32) |
| `CARD_VISION_TTA` | `false` | Test-time augmentation (slower, sometimes more accurate) |

---

## Analysis (`notebooks/`)

`analysis.ipynb` loads an exported CSV and produces position difference distributions, per-card tracking across trials, and mean/median absolute position change by starting position.
