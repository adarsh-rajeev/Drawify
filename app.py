import hashlib
import io
import json
import random
import time
from typing import List, Tuple

import pandas as pd
import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__, static_folder="static", template_folder="templates")


# -------------------------------
# Utilities
# -------------------------------

def canonicalize_entries(entries: List[str]) -> List[str]:
    canon = []
    for e in entries:
        if e is None:
            continue
        s = str(e).strip()
        if not s:
            continue
        canon.append(s)
    return canon


def deduplicate_preserve_order(entries: List[str]) -> List[str]:
    seen = set()
    out = []
    for e in entries:
        if e not in seen:
            seen.add(e)
            out.append(e)
    return out


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def dataframe_from_upload(file_storage) -> pd.DataFrame:
    if not file_storage or file_storage.filename == "":
        raise ValueError("No file provided.")
    filename = file_storage.filename.lower()
    data = file_storage.read()
    file_storage.stream.seek(0)

    try:
        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(data), dtype=str, keep_default_na=False)
        elif filename.endswith(".xlsx"):
            df = pd.read_excel(io.BytesIO(data), dtype=str, engine="openpyxl")
        else:
            raise ValueError("Unsupported file type. Please upload a .csv or .xlsx file.")
    except Exception as e:
        raise ValueError(f"Failed to parse file: {e}")

    df.columns = [str(c) for c in df.columns]
    return df


def entries_from_dataframe(df: pd.DataFrame, column: str, dedupe: bool) -> Tuple[List[str], str, List[str]]:
    if column not in df.columns:
        raise ValueError(f"Selected column '{column}' was not found in the file.")

    raw_entries = df[column].tolist()
    canon = canonicalize_entries(raw_entries)
    if dedupe:
        canon = deduplicate_preserve_order(canon)

    payload = json.dumps(canon, ensure_ascii=False, separators=(",", ":"), sort_keys=False).encode("utf-8")
    dset_hash = sha256_hex(payload)

    return canon, dset_hash, raw_entries[:10]


def get_drand_latest() -> Tuple[int, str]:
    url = "https://api.drand.sh/public/latest"
    try:
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        j = r.json()
        round_no = int(j.get("round"))
        randomness_hex = j.get("randomness")
        if not randomness_hex or not isinstance(randomness_hex, str):
            raise ValueError("drand response missing randomness.")
        return round_no, randomness_hex
    except requests.RequestException as e:
        raise ValueError(f"Failed to fetch drand randomness: {e}")


def derive_seed(dataset_hash_hex: str, drand_hex: str) -> bytes:
    return hashlib.sha256((dataset_hash_hex + drand_hex).encode("utf-8")).digest()


def fisher_yates_shuffle(n: int, rng: random.Random) -> List[int]:
    idx = list(range(n))
    for i in range(n - 1, 0, -1):
        j = rng.randrange(0, i + 1)
        idx[i], idx[j] = idx[j], idx[i]
    return idx


# -------------------------------
# Routes
# -------------------------------

@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/draw", methods=["GET"])
def draw():
    return render_template("draw.html")


@app.route("/api/analyze", methods=["POST"])
def api_analyze():
    try:
        file = request.files.get("file")
        df = dataframe_from_upload(file)
        preview_rows = 10
        preview = df.head(preview_rows).to_dict(orient="records")
        return jsonify({
            "ok": True,
            "columns": list(df.columns),
            "row_count": int(len(df)),
            "preview": preview
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/draw", methods=["POST"])
def api_draw():
    try:
        file = request.files.get("file")
        column = request.form.get("column", "").strip()
        dedupe_str = request.form.get("dedupe", "false").lower()
        k_str = request.form.get("k", "1").strip()

        if not column:
            raise ValueError("Please select a column for participant IDs.")

        try:
            k = int(k_str)
        except ValueError:
            raise ValueError("Number of winners (k) must be an integer.")
        if k <= 0:
            raise ValueError("Number of winners (k) must be greater than 0.")

        dedupe = dedupe_str in ("true", "1", "on", "yes")

        df = dataframe_from_upload(file)
        entries, dataset_hash_hex, _ = entries_from_dataframe(df, column, dedupe)

        n = len(entries)
        if n == 0:
            raise ValueError("No valid entries found after cleaning.")
        if k > n:
            raise ValueError(f"Number of winners (k={k}) cannot exceed number of entries (n={n}).")

        drand_round, drand_hex = get_drand_latest()
        seed = derive_seed(dataset_hash_hex, drand_hex)
        rng = random.Random(int.from_bytes(seed, "big"))

        order = fisher_yates_shuffle(n, rng)
        winner_indices = order[:k]
        winners = [entries[i] for i in winner_indices]

        receipt = {
            "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "dataset_hash_sha256_hex": dataset_hash_hex,
            "drand_round": drand_round,
            "drand_randomness_hex": drand_hex,
            "seed_sha256_hex": sha256_hex(seed),
            "n": n,
            "k": k,
            "winner_indices": winner_indices,
            "winners": winners,
            "parameters": {"column": column, "dedupe": dedupe},
            "algorithm": "Fisher–Yates, RNG seed = sha256(dataset_hash || drand_randomness_hex)",
            "app": "Fair Lucky Draw Flask App",
            "version": "0.1.0"
        }

        return jsonify({"ok": True, "winners": winners, "receipt": receipt})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


if __name__ == "__main__":
    # For local dev; in production use a WSGI server.
    app.run(host="127.0.0.1", port=5000, debug=True)