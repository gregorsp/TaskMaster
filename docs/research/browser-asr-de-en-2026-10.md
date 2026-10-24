# German + English STT fully in-browser (PWA): Parakeet TDT 0.6B v3 int4 vs alternatives

Research date: 2026-10-23. All sizes are as reported by the source (MB = decimal unless marked MiB).
Claims I could not verify are marked **[UNVERIFIED]**.

---

## 0. Bottom line

| Question | Answer |
|---|---|
| Does Parakeet v3 cover German? | **Yes.** 25 European languages incl. `de`. FLEURS de WER **5.04 %** (NVIDIA), **5.24 %** (independent transcribe.cpp Q8_0), **5.48 %** (independent fp32 export). Best-in-class for German at this size. |
| Is int4 the right call? | **For size, yes. For speed, no.** int4 (w4a8) is *slower* than int8 on CPU (arith-bound) and costs real accuracy on long single passes (+3.1 pp WER). On short German clips it costs only +0.2 pp. |
| Can it run in a browser today? | **Yes, shipped.** `parakeetweb.olicorne.org` runs it client-side; sherpa-onnx ships official WASM demos; `parakeet.js` is an npm package. WebGPU is optional and only wins on desktop GPUs. |
| Is int4/MatMulNBits supported on WebGPU? | **Yes** (ORT WebGPU has a `MatMulNBits` kernel; it dequantizes to fp16). But the practical default everywhere is **int8 on WASM**. |
| Mobile? | **Marginal.** ~1.1–1.7 GB resident for int8. iOS Safari is the risk. Ship **w4a8 (383 MB)** or **redux w2a8 (190 MB)**, not int8. |
| Timestamps? | **Yes**, token/word-level from the TDT duration head, reachable in-browser. No forced alignment needed. |
| PWA 300–700 MB download+cache? | **Realistic on desktop + Android Chrome; risky on iOS** (Safari ≈1 GB/origin, 7-day eviction for non-installed origins). |

---

## 1. Parakeet TDT 0.6B v3 — model facts

Source: [nvidia/parakeet-tdt-0.6b-v3 model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3)

- **Params:** 600 M ("0.6B"), released 2025-08-14.
- **License:** **CC-BY-4.0** — confirmed. Commercial use allowed. ("This model is ready for commercial/non-commercial use." / "GOVERNING TERMS: … CC-BY-4.0".)
- **Architecture:** **FastConformer-TDT** — FastConformer encoder + TDT (Token-and-Duration Transducer) decoder. Transducer, **not** CTC, **not** attention-encoder-decoder.
- **Languages (25):** bg, hr, cs, da, nl, **en**, et, fi, fr, **de**, el, hu, it, lv, lt, mt, pl, pt, ro, sk, sl, es, sv, ru, uk. Language is auto-detected, no prompt needed.
- **Tokenizer:** unified SentencePiece, **8,192 tokens**, shared across all 25 languages.
- **Input:** 16 kHz mono. **Output:** punctuated + capitalized text.
- **Long audio:** up to 24 min with full attention; up to 3 h with local attention (`rel_pos_local_attn`, [256,256]).
- **German WER (official):** FLEURS de **5.04 %**, CoVoST2 de **4.84 %**. (FLEURS en 4.85 %, es 3.45 %, fr 5.15 %, it 3.00 %.)
- **Independent German WER:** FLEURS de **5.24 %** ([transcribe.cpp Q8_0](https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/parakeet-tdt-0.6b-v3.md)); FLEURS de **5.48 % / CER 1.80 %** ([Olicorne full-FLEURS sweep](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx)).
- **Minimum RAM (NVIDIA, fp32/NeMo):** 2 GB.

### 1.1 Quantized ONNX builds that actually exist (Oct 2026)

| Repo | Files & exact sizes | Quant recipe | Notes |
|---|---|---|---|
| [`istupakov/parakeet-tdt-0.6b-v3-onnx`](https://huggingface.co/istupakov/parakeet-tdt-0.6b-v3-onnx) | `encoder-model.int8.onnx` **622 MiB**; `decoder_joint-model.int8.onnx` **17.4 MiB**; fp32 encoder `.onnx.data` **2 322.6 MiB**; fp32 decoder 69.2 MiB | int8 **dynamic** (naive `DynamicQuantizeLinear`/`MatMulInteger`) | **Reference export** (onnx-asr). ⚠️ Naive int8 **degrades badly past ~20–30 s** of audio (long-audio collapse) — documented by Olicorne. Total int8 ≈ 640 MiB / 670 MB. |
| [`efederici/parakeet-tdt-0.6b-v3-onnx-int4`](https://huggingface.co/efederici/parakeet-tdt-0.6b-v3-onnx-int4) | `encoder-model.int4.onnx` **372.8 MiB (391 MB)**; `decoder_joint-model.int8.onnx` 17.4 MiB; `nemo128.int8.onnx` 42 KB; `vocab.txt` 94 KB | **int4 MatMulNBits, block_size=64, asymmetric** + int4 pointwise Conv (via onnx-conv2matmul); depthwise Conv fp32; decoder int8 dynamic | **409 MB total.** Claims: LibriSpeech-clean WER 1.67 % (vs fp32 1.72 %), RTF 0.074 CPU, 0.42 % degradation vs fp32, "compatible with ONNX Runtime (CPU, WASM, WebGPU)". Built for [`parakeet.js`](https://github.com/ysdede/parakeet.js). |
| [`Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx`](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx) | `int8/encoder-model.int8.onnx` **650 MB**; `w4a8/encoder-model.w4a8.onnx` **383 MB**; `fp16/` **1 218 MB**; `fp32/` **2 436 MB** (sharded <2 GB); `int8/decoder_joint-model.int8.onnx` 18 MB; `fp32/decoder…` 73 MB; `nemo128.onnx` 137 KB | MatMulNBits, block 64 (int8) / block 32 (w4a8), symmetric, `accuracy_level=4`; **mask-free, runtime positional encoding, no length cap** | **The best-documented browser export.** Full 25-language FLEURS + long-audio benchmarks + German per-language row. Superseded by `…-ultra-onnx` per its own README, but still the build with the public benchmark record. |
| [`csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`](https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8) | `encoder.int8.onnx` **622 MiB**; `decoder.int8.onnx` 11.3 MiB; `joiner.int8.onnx` 6.1 MiB; `tokens.txt`; `test_wavs/de.wav` | int8 | sherpa-onnx layout (encoder/decoder/joiner), used by the official WASM demos. |
| [`HariDangi/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8`](https://huggingface.co/HariDangi/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8) | identical file set/sizes | int8 | Mirror of the above. |
| `handy-computer/parakeet-tdt-0.6b-v3-gguf` | Q8_0 **740 MB**, Q6_K 610 MB, Q5_K_M 549 MB, **Q4_K_M 485 MB**, F16 1.26 GB | ggml K-quants | **Native only** (transcribe.cpp). Not browser-loadable. Good for the Pi fallback. |
| `moondream/parakeet-ultra`, `…-redux` | redux w2a8 encoder **190 MB** | ternary weights → exact 2-bit | See §6. |

**Not found (important negative results):**
- **`onnx-community` has no v3 build.** It publishes only [`onnx-community/parakeet-tdt-0.6b-v2-ONNX`](https://huggingface.co/onnx-community/parakeet-tdt-0.6b-v2-ONNX) — **v2 = English only**, 0 downloads/month.
- **`k2-fsa/sherpa-onnx` GitHub releases do not ship model weights** (they ship binaries + demo apps). Weights live on HF under `csukuangfj/*`.
- No `int4` build exists in the sherpa-onnx model family (int8/fp16 only).

---

## 2. Browser runtime support — actual status

### 2.1 onnxruntime-web + WebGPU + int4 (MatMulNBits) — **yes**

- ORT's WebGPU EP has a real `MatMulNBits` kernel: [PR #19446 "[JS/WebGPU] Add MatMulNBits"](https://github.com/microsoft/onnxruntime/pull/19446), implementation in [`contrib_ops/webgpu/quantization/matmul_nbits.cc`](https://github.com/microsoft/onnxruntime/blob/main/onnxruntime/contrib_ops/webgpu/quantization/matmul_nbits.cc).
- `parakeet.js@1.4.4` (npm, published ~Apr 2026) pins **`onnxruntime-web@1.24.1`** and exposes `backend: 'webgpu' | 'wasm'`.
- **Caveat that matters:** on WebGPU the MatMulNBits kernel **dequantizes to fp16** — so int4 weights are a bandwidth/size play on GPU, and **`shader-f16` is mandatory**. Without that adapter feature the model "builds and then returns an empty transcript" (measured by parakeet_web on a Dawn build lacking `shader-f16`).
- **Second caveat, bigger:** WebGPU used to be *15× slower* than WASM for this model, because the encoder emits hundreds of dynamic-shape ops ORT-web has no GPU kernels for, **and** because ORT yields to the event loop ~2 000× per encoder run while Chromium throttles those callbacks to the compositor frame rate. Pausing page animations during a GPU run took a 3-min clip from **12 min 39 s → 8.5 s**. Any PWA doing WebGPU inference must suppress animations/rAF work while encoding.

### 2.2 transformers.js — **Parakeet CTC only, no TDT** ⚠️

Verified by listing the repo tree of `huggingface/transformers.js@main` (2026-10-23):

```
packages/transformers/src/models/parakeet/modeling_parakeet.js   → export class ParakeetForCTC
packages/transformers/src/models/parakeet/feature_extraction_parakeet.js
```

There is **no `nemo-conformer-tdt` / TDT decoder anywhere in the tree** (grep for `tdt|nemo|parakeet` returns only the above). A community packaging exists — [`ysdede/parakeet-tdt-0.6b-v2-onnx-tfjs4`](https://huggingface.co/ysdede/parakeet-tdt-0.6b-v2-onnx-tfjs4) — whose card claims a "custom `nemo-conformer-tdt` implementation in Transformers.js v4"; **it is not in the official repo** and is v2/English. **[UNVERIFIED as a supported upstream path.]** Do not plan on `pipeline('automatic-speech-recognition', 'nvidia/parakeet-tdt-0.6b-v3')` working today.

(Note: Transformers.js v4 does use `com.microsoft.MatMulNBits` for its `q4`/`q4f16` dtypes and ships a C++ WebGPU runtime — so the *infrastructure* is there; the *Parakeet-TDT model class* is not.)

### 2.3 sherpa-onnx WASM — **yes, officially, including Parakeet v3 multilingual**

- sherpa-onnx **v2.0.0 (2026-10-23)** ships prebuilt Flutter **web** demos that bundle Parakeet v3:
  - `flutter-vad-non-streaming-asr-from-file-nemo-parakeet-v3-eu-web.zip` (**473.6 MB**)
  - `flutter-vad-non-streaming-asr-from-microphone-nemo-parakeet-v3-eu-web.zip` (**473.5 MB**)
  (see [releases](https://github.com/k2-fsa/sherpa-onnx/releases))
- The `nemo-transducer` engine type (encoder + decoder + joiner) is what Parakeet TDT uses; a production app reports it "loads and transcribes in Electron and browser without OOM" ([sokuji design spec, 2026-03-18](https://github.com/kizuna-ai-lab/sokuji/blob/main/docs/superpowers/specs/2026-03-18-parakeet-tdt-integration.md)): 671 MB `.data`, **WASM load 5–15 s**, **~1.2 GB WASM heap**, **RTF 0.5–2.0** desktop.
- **Caveats:** sherpa-onnx's web build is **WASM SIMD, CPU-only** — no WebGPU path **[UNVERIFIED but consistent across docs/demos]**. Parakeet in sherpa-onnx is **offline/whole-utterance only**; streaming support is an open upstream issue ([#2918](https://github.com/k2-fsa/sherpa-onnx/issues/2918)). Known greedy-decoding missing-word bug ([#2605](https://github.com/k2-fsa/sherpa-onnx/issues/2605)).

### 2.4 Real web demos (verified to exist)

| Demo | Stack | Status |
|---|---|---|
| [parakeetweb.olicorne.org](https://parakeetweb.olicorne.org/) ([source](https://github.com/thiswillbeyourgithub/parakeet_web), AGPLv3) | fork of parakeet.js, ONNX Runtime Web | **Production-grade, fully client-side.** WASM int8 default, WebGPU opt-in after on-device timing, word timestamps, diarization (Sortformer), ffmpeg.wasm, live mode, OpenAI-compatible server mode. |
| [parakeet.js](https://github.com/ysdede/parakeet.js) (npm `parakeet.js`) | ONNX Runtime Web | Reference library. `transcribe()`, `transcribeLongAudio({chunkLengthS: 95})`, `returnTimestamps`. |
| sherpa-onnx Flutter web demos | sherpa-onnx WASM | Official; VAD + non-streaming ASR, file & mic. |

---

## 3. Timestamps — **yes, token/word-level, from the TDT duration head**

- NVIDIA NeMo: `transcribe(..., timestamps=True)` returns **char, word and segment** timestamps.
- Transformers (Python): `processor.decode(output.sequences, durations=output.durations, …)` — the durations come out of `generate()`.
- **In the ONNX graph the duration logits are present.** The TDT joint emits, per step, 8 193 token logits **+ 5 duration logits** (durations {0,1,2,3,4} × encoder-frame stride). Olicorne's decoder surgery explicitly exposes `duration_logits` (fp32, last dim 5), plus `lse_token`, `lse_duration`, `topk_logits`, `topk_ids` — i.e. durations are first-class graph outputs, not something you have to reconstruct.
- **Browser-reachable:** `parakeet.js` exposes `returnTimestamps: true` and parakeet_web ships "per-word timestamps" as a feature. Token→word grouping is done in JS (SentencePiece `▁` boundaries) off the accumulated frame durations.
- **So no forced alignment and no Whisper-style cross-attention needed.** Practical fallback is only needed if you pick a runtime that doesn't surface durations (e.g. generic CTC export, or sherpa-onnx's NeMo path if it doesn't return word times — **[UNVERIFIED]**). Fallbacks in that case: VAD-chunk boundaries (segment-level only), or a CTC forced aligner.

---

## 4. Practical limits

### 4.1 Memory (resident, not file size)

| Build | Load RSS | After runs | Source |
|---|---|---|---|
| int8 (MatMulNBits, block 64) | **1 096 MB** | **1 700 MB** (4 × 30 s) | Olicorne, measured native; int8 block 32 was 1 209 / 1 808 MB |
| w4a8 (int4) | lower (not published) | — | — |
| WASM heap (sherpa-onnx int8) | ~1.2 GB | — | sokuji spec |
| fp32 | ~2.3 GB resident + 2.4 GB download | — | Olicorne |

**Hard browser ceilings found:**
- wasm32: any single `ArrayBuffer` ≤ **2³¹−1 B (~2 GB)**; Chromium refuses `blob:` fetch > ~2 GB. This is why fp32 ships sharded.
- **Read-back wall: "a browser refuses to read back more than about 2.1 GB of stored weights"** (parakeet_web) — directly constrains Cache/IndexedDB strategies.
- iOS: large WASM + WebWorkers crashing the tab is a live WebKit issue ([bug 314551](https://bugs.webkit.org/show_bug.cgi?id=314551)) — **[UNVERIFIED: I could only see the title in search results; wiki.webkit.org returned 404].**

**Mobile verdict:** int8 (650–900 MB download, ~1.1–1.7 GB RSS) is **desktop-class**. On iOS assume you have ≲1.5 GB of tab memory before jetsam; on mid-range Android similar. Plan for **w4a8 (383 MB)** or **redux w2a8 (190 MB)** on phones.

### 4.2 WebGPU availability (caniuse, data through Sept 2026)

| Browser | Status |
|---|---|
| Chrome desktop 113–159 | ✅ supported |
| Chrome **Android 156** | ✅ supported |
| Safari **iOS 26.0–27.2** | ✅ supported |
| Safari **macOS 26.0+** | ◐ **partial** |
| Firefox 141–161 | ❌ **still disabled by default** (flag only) |
| Global usage | **85.8 % + 2.02 % = 87.82 %** |

Source: [caniuse.com/webgpu](https://caniuse.com/webgpu). Implication: **WebGPU is a progressive enhancement, never a requirement** — and on Firefox it is simply absent. Also, iOS 26 GPU path still needs `shader-f16` for fp16 and is unproven for this encoder.

### 4.3 WASM-CPU fallback speed

Measured, desktop CPU (parakeet_web / Olicorne, 90 s profile): fp32 ≈ **2.8× realtime**, int8 ≈ **2.5×**, w4a8 ≈ **2.4×** (i.e. RTF ≈ 0.35–0.42). Native laptop (Ryzen 7 4750U, transcribe.cpp Q8_0): **12–15× realtime**.

**Mid-range phone estimate: RTF ≈ 2–4 (i.e. 2–4× slower than real time) for int8** — **[UNVERIFIED extrapolation]**: no published phone measurement for this model exists; it follows from ~5–10× lower sustained int8 throughput than a laptop core plus memory-bandwidth pressure. Treat "Parakeet on a mid-range phone over WASM" as *not interactive*; w4a8/w2a8 help mostly by reducing memory traffic, and even then expect ≈1–2× realtime at best.

---

## 5. Model delivery in a PWA

**Downloads to plan for**

| Variant | Download | +decoder/tokenizer | Fits iOS ~1 GB? |
|---|---|---|---|
| int8 MatMulNBits (browser-tuned) | 650 MB (int8 encoder) | ≈ 670 MB | borderline ✗ |
| int8 istupakov (naive) | 622 MiB | ≈ 640 MiB | borderline ✗ |
| **w4a8 (int4)** | **383 MB** | ≈ 400 MB | ✓ |
| **redux w2a8** | **190 MB** | ≈ 210 MB | ✓ comfortable |
| fp16 | 1 218 MB | — | ✗ |
| fp32 sharded | 2 436 MB | — | ✗ |

**Quota**

| Platform | Per-origin quota | Eviction |
|---|---|---|
| Chrome/Edge desktop & Android | **60 % of disk** per origin (browser total 80 %); Incognito ≈5 % | LRU under pressure unless `navigator.storage.persist()` |
| Firefox | 50 % of free disk; **2 GB per eTLD+1** ([web.dev](https://web.dev/articles/storage-for-the-web)); one 2026 secondary source says 20 % / 10 GB cap — **conflicting [UNVERIFIED]** | LRU |
| **Safari (macOS + iOS)** | **≈1 GB per origin**, then a prompt, +200 MB increments; installed PWA gets its **own** container | **7-day cap on all script-writable storage for non-installed sites**; installed PWAs exempt |

**Cache Storage vs OPFS vs IndexedDB**
- Cache Storage: right for the app shell; workable for weights (HTTP-cacheable, range-friendly), but note ORT reads weights into an `ArrayBuffer` anyway.
- OPFS: right for multi-hundred-MB blobs, supports sync access handles in workers, and avoids the ">2.1 GB read-back" and blob-URL walls. **Recommended for weights.**
- IndexedDB: what parakeet_web actually uses (models "cached in IndexedDB", with progress + resume). Works, but adds a copy.

**Realism of a 300–700 MB download + cache**
- Desktop Chrome / Android Chrome: **yes**, routine. Serve **zstd-precompressed** (parakeet_web: int8 encoder 841 MB → **643 MB**, −27 %, browser decodes in ~3 s).
- iOS: **300–400 MB yes; 650 MB+ is risky** — ~1 GB cap, share it with the app shell and any diarization model (int8 Sortformer adds ~100 MB), and a non-installed origin can be wiped after 7 days. Call `navigator.storage.persist()`, prefer the smallest viable encoder, and design for re-download.

---

## 6. Alternatives with strong German — ranked

German numbers below are **WER % (lower better)**, with the eval set named. Cross-set comparisons are indicative only (different normalization).

| # | Option | German WER | Size (browser-viable build) | Streaming | Mobile | Notes |
|---|---|---|---|---|---|---|
| **1** | **Parakeet TDT 0.6B v3** int8 | **5.04–5.48** (FLEURS) | 650–670 MB (int8), 383 MB (w4a8), 190 MB (redux w2a8) | ✗ offline | marginal | Best German-per-byte. Punctuation+caps+timestamps built in. CC-BY-4.0. |
| 2 | **Parakeet-ultra / redux** (moondream, further-trained v3) | macro FLEURS **11.57 %** (ultra) / **12.64 %** (redux) vs 13.14 % plain v3 — **German row not published [UNVERIFIED]** | 190 MB (redux w2a8) | ✗ | **best** | Ternary weights make 2-bit lossless. This is the mobile play. |
| 3 | **Whisper large-v3** (transformers.js int8 / whisper.cpp) | FLEURS de **CER 4.93** (≈2.7× Parakeet's 1.80 CER) → WER roughly 8–11 % **[UNVERIFIED derivation]** | int8 ≈ 1.5 GB+ → **not browser-viable** | ✗ | ✗ | Slow, hallucinates on silence, needs 30 s windows. |
| 4 | **Whisper small / medium** int8 | no reliable public German WER found **[UNVERIFIED]** — materially worse than large-v3 | small ≈ 250–480 MB | ✗ | ✓ (small) | Only if you need Whisper's ecosystem (word timestamps via cross-attention, `whisper.cpp` WASM builds). |
| 5 | **Vosk German** (`vosk-model-de-0.21`) | **9.83** Tuda-de / **12.82** cv-test / 12.42 mls | **1.9 GB** | ✓ **true streaming** | ✗ | [alphacephei.com/vosk/models](https://alphacephei.com/vosk/models). Kaldi, no punctuation, low latency, low RAM per second. |
| 5b | Vosk `small-de-0.15` | **13.75** Tuda-de / 30.67 podcast | **45 MB** | ✓ streaming | ✓ | 45 MB, ~300 MB RAM, but ~2.6× worse than Parakeet. Fallback tier only. |
| 6 | **Canary-1B-v2** | 25 EU langs incl. `de`; **German WER not published** in the transcribe.cpp port **[UNVERIFIED]** | Q4_K_M **701 MB**, Q8_0 1.1 GB (GGUF, native) | ✗ | ✗ | 978 M params, needs explicit `-l de`, **no timestamps in the port**, 6–9× realtime on Ryzen CPU (vs Parakeet 12–15×). Adds translation. |
| 7 | **Moonshine** | **English-only** → unusable for German | tiny/base ≈ 190 MB | ~streaming | ✓ | Correct to exclude. |
| 8 | **sherpa-onnx zipformer German (Kroko)** | German streaming models were merged into sherpa-onnx ([PR #2502](https://github.com/k2-fsa/sherpa-onnx/pull/2502)); **WER not verified [UNVERIFIED]** | small (tens of MB) | ✓ streaming | ✓ | The one to benchmark if you need *streaming German* on mobile. |
| 9 | **BuzzASR/german** (Whisper-large-v3 fine-tune) | FLEURS **5.78** WER / 1.75 CER; CV25 10.42 | large-v3 size → not browser-viable | ✗ | ✗ | Server-side option only. [card](https://huggingface.co/BuzzASR/german) |

**Reading:** for German, Parakeet v3 is **~2× better than the best Vosk German** (5.2 % vs 9.8 % Tuda-de-ish) and **~2.7× better CER than Whisper large-v3 on FLEURS**, at 1/3 the size of Whisper large-v3. Nothing in the 2026 on-device field beats it on German quality-per-MB.

---

## 7. Long-form / streaming in the better demos

- **parakeet_web does not use Silero VAD.** It uses **fixed-window chunking**: a **60 s** window by default (user-selectable 20/30/60; 30 s in medical mode; 10 s suggested on phones), chunks encoded **in parallel workers**, then seam-stitched. Measured: going from 20 s → 60 s windows cost **+7 % CPU time** but bought **~0.5 pp WER**.
- **"Live transcription"** = re-run the whole model every few seconds over a **sliding window** of recent audio and replace the tail of the transcript. That is pseudo-streaming: **latency ≈ one window pass**, i.e. ~1–5 s behind speech, and it re-encodes overlapping audio (wasteful but simple and accurate).
- **Silero VAD** is the approach in the *other* family: sherpa-onnx's official web demos are literally named `flutter-vad-non-streaming-asr-from-microphone-nemo-parakeet-v3-eu-web.zip` — Silero VAD segments, then the offline transducer transcribes each segment. Silero VAD v5 ONNX is ~2 MB and runs fine on ORT-web/WASM.
- **Why not true streaming:** Parakeet has **no streaming/chunked-state mode** in ONNX; NeMo offers a `chunk_secs/left_context/right_context` scripted path, but the exported graphs are whole-utterance and re-run the encoder. Upstream streaming is open ([#2918](https://github.com/k2-fsa/sherpa-onnx/issues/2918)).
- **Practical recipe:** Silero VAD → cut at ≥300–500 ms pauses → transcribe each segment with the offline model → append, keeping a small overlap; emit timestamps from TDT durations offset by the segment start. Expect **~0.5–2 s** perceived latency on desktop; on phones the model pass itself dominates.

---

## 8. Server-side fallback on Raspberry Pi 4/5

**Anchors (measured):**
- Parakeet 0.6B **Q8_0 / Q4_K_M**, transcribe.cpp, **AMD Ryzen 7 4750U (8 threads, Zen2)**: **12–15× realtime** CPU; 24–26× on Vulkan. ([doc](https://github.com/handy-computer/transcribe.cpp/blob/main/docs/models/parakeet-tdt-0.6b-v3.md))
- Same model on **Apple M4 Max CPU**: 35–38× realtime.
- Pi 5 (Cortex-A76 ×4 @ 2.4 GHz) is roughly **1/3 to 1/5** of that Ryzen on int8 GEMM → **≈2–5× realtime (RTF 0.2–0.5)** for Q8_0, better with Q4_K_M. **[UNVERIFIED extrapolation — no published Pi 5 Parakeet benchmark found.]**
- Pi 4 (Cortex-A72 ×4 @ 1.5 GHz, no NEON-int8 uplift worth the name): **≈0.5–1.5× realtime** → not usable for long-form, OK for short utterances. **[UNVERIFIED extrapolation.]**
- A `litert-community` model card reports "Raspberry Pi 5 · LiteRT 2.2.0 · CPU/XNNPACK, 4 threads · **110 ms p50**" for an int8 Parakeet CTC 0.6B (ja) on a "5 s" profile — **physically implausible for 5 s of audio** (0.6 B params ⇒ ~600 GFLOP; that would be >5 TFLOP/s on a Pi). **Do not use this number**; I flag it as a mislabeled measurement.
- whisper.cpp `small` on Pi 5 is commonly reported at **≈0.5–1.5× realtime**, `base` ≈ 2–3×, `tiny` ≈ 4–6× **[UNVERIFIED — no single authoritative benchmark fetched]**; academic benchmark papers exist ([Whisper-series on Raspberry Pi, ACM/IEEE SEC 2026](https://dl.acm.org/doi/abs/10.1145/3769102.3774244); [GPU Servers to Raspberry Pi, IEEE Edge 2026](https://ieeexplore.ieee.org/document/11662395)) but I could not read their tables.

**Is Pi 5 + AI HAT realistic?** **No, not for Parakeet today.** The AI HAT+ (Hailo-8/8L, 13/26 TOPS) only runs models compiled to Hailo's HEF format via the Hailo Dataflow Compiler; there is **no evidence of anyone compiling FastConformer-TDT/Parakeet to HEF**, and the transducer's autoregressive decoder loop is a poor fit for a dataflow accelerator **[UNVERIFIED / negative result]**. Realistic Pi 5 plan: **CPU-only**, `transcribe.cpp` + `parakeet-tdt-0.6b-v3-Q5_K_M/Q4_K_M` (485–549 MB), or `sherpa-onnx` int8 (640 MB), expect **RTF 0.2–0.5** (2–5× realtime) at ~1.5–2 GB RSS on a 8 GB Pi 5. Pi 4: drop to whisper.cpp `base`/`tiny` or Vosk small.

---

## 9. Recommendation table

| Role | Runtime | Model (exact) | Size | German quality | Mobile |
|---|---|---|---|---|---|
| **Desktop/Android PWA, default** | onnxruntime-web **WASM int8** | `Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx` → `int8/encoder-model.int8.onnx` + `int8/decoder_joint-model.int8.onnx` | **~670 MB** (zstd ≈ 490 MB) | **FLEURS de 5.49 %** | ✗ (borderline) |
| Desktop PWA, GPU enhancement | ORT-web **WebGPU** (guard on `shader-f16`, pause animations) | same repo, `fp16/` (1.2 GB) or `int8/` (works on GPU too) | 1.2 GB / 670 MB | ≈ fp32 | ✗ |
| **Mobile (iOS/Android) PWA** | ORT-web WASM | `…-optimized-onnx` → `w4a8/encoder-model.w4a8.onnx` + `int8/decoder…` | **~400 MB** | **FLEURS de 5.68 %** (+0.2 pp) — but **+3.1 pp on long single passes** | ✓ |
| **Mobile, smallest** | ORT-web WASM | `Olicorne/parakeet-tdt-0.6b-v3-redux-onnx` → `w2a8/` | **~210 MB** | macro FLEURS 12.64 % (≈ int8 v3's 13.14); **German row unpublished** | ✓✓ |
| Simplest integration, single-file model | **sherpa-onnx WASM** | `csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8` (encoder 622 MiB + decoder 11 + joiner 6) | ~640 MiB | same model | ✓ (600 MB) |
| Quick prototype / experiment | `parakeet.js` + `efederici/…-onnx-int4` | int4 encoder 391 MB + int8 decoder 17 MB | **409 MB** | LibriSpeech 1.67 % (English); **German unmeasured** | ✓ |
| If you need **true streaming** German | sherpa-onnx WASM | Kroko German streaming zipformer (**[UNVERIFIED WER]**) or Vosk `small-de-0.15` (45 MB, Tuda-de 13.75 %) | 45–120 MB | worse (2.6× Parakeet's WER) but real-time | ✓✓ |
| Server fallback | transcribe.cpp / sherpa-onnx on Pi 5 | `parakeet-tdt-0.6b-v3-Q5_K_M.gguf` (549 MB) | 549 MB | same | n/a |

**My recommendation**
1. **Single model, two precisions in one repo:** ship `Olicorne/parakeet-tdt-0.6b-v3-optimized-onnx` — `int8/` on desktop, `w4a8/` on mobile, chosen by `navigator.deviceMemory`/UA + a cached timing probe. Same tokenizer, same decoder, same code path. That is exactly what parakeet_web does, and it is the only Parakeet deployment with a real German benchmark record.
2. **Do not build on transformers.js for TDT.** It is not supported upstream (verified). Either adopt `parakeet.js` (small, MIT, WebGPU-aware, timestamps) or drive `onnxruntime-web` yourself.
3. **Do not expect int4 to be faster.** It is smaller; on CPU it is slower than int8. Choose int4 for *download/RAM*, int8 for *speed and long-form accuracy*.
4. **Budget for chunked, not streaming.** VAD (Silero, ~2 MB) or 60 s windows + TDT durations for word timestamps; latency ~0.5–2 s desktop, worse on phones.
5. **Treat iOS as the constraint that decides your model size**, not desktop. 400 MB max, OPFS, `persist()`, zstd, and a graceful "smaller model" downgrade.

---

## 10. Explicitly unverified / open

1. **transformers.js TDT support** — absent from `main` tree; a v4 npm release *could* differ from `main`, and the `ysdede/…-tfjs4` card claims otherwise. Not production-safe either way.
2. **German WER for:** Whisper small/medium, Canary-1b-v2, Kroko/zipformer German, parakeet-ultra & redux per-language. No primary numbers found.
3. **Any phone measurement** of Parakeet WASM/WebGPU. All mobile RTF figures here are extrapolations.
4. **Pi 4/5 Parakeet numbers** — extrapolated from Ryzen; the one "Pi 5 · 110 ms" figure I found is internally inconsistent and I discard it. The two academic Pi/Whisper benchmark papers were paywalled.
5. **iOS Safari practical ceiling** — the WebKit bug on large WASM + WebWorkers (314551) could not be read (404 on the mirror).
6. **Safari storage quota in 2026** — ~1 GB/origin comes from web.dev (updated 2024-09-23) and one 2026 secondary source; Apple publishes no official number.
7. **Firefox quota** — web.dev says 2 GB/eTLD+1, a 2026 blog says 20 %/10 GB. Conflict unresolved.
8. **sherpa-onnx web = CPU-only** — strongly implied by the demo set and docs, but not stated in one authoritative sentence I could fetch.
9. **Whether sherpa-onnx's NeMo path returns word timestamps in WASM.**
10. **Whether `efederici/…-int4`'s German quality holds** — its benchmark is English (LibriSpeech) only.
