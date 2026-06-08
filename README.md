# Shuffle Research

Research project studying wash card shuffle mechanics — specifically how individual cards move through a deck across repeated wash shuffle trials.

## Setup

**First time only:**

```bash
cd card-vision
python3 -m venv env
env/bin/pip install -r requirements.txt

cd ../csv-card-editor
npm install
```

**Run:**

```bash
cd csv-card-editor
npm run dev
```

Starts the CSV editor at http://localhost:3000 and the card-vision backend at http://127.0.0.1:8787.

---

## Data model

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
