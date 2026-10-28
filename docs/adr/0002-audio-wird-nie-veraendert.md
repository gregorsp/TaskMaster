# Audio wird unverändert gespeichert

`MediaRecorder` liefert Ogg/Opus oder WebM/Opus ohne korrekte Dauerangabe und ohne Cues; im Browser
meldet ein solches File `duration === Infinity`, und die Seek-Leiste ist kaputt. Der übliche Ausweg
wäre ein Remux mit ffmpeg beim Ingest — das kostet ein zusätzliches Binary im Image und schreibt die
Datei des Nutzers um. Wir speichern stattdessen die Bytes so, wie das Gerät sie erzeugt.

Folge: Dauer und Zeitleiste kommen aus der App (`durationMs` beim Aufnehmen mitgeschrieben, Peaks
später), nicht aus dem Container. Dafür stimmen die ASR-Zeitstempel ohne Korrektur, und ein späterer
Wechsel des Ablageformats bleibt eine reine Metadaten-Änderung. Die 80-ms-Zeitstempel der Engine
bleiben damit die einzige Fehlerquelle — kein Versatz durch Schneiden oder Neukodieren.

**Ergänzung durch [ADR 0003](0003-server-transkription-nachts.md):** Der Server dekodiert die Dateien
inzwischen selbst zu PCM — per WASM in JavaScript, weiterhin ohne ffmpeg und ohne die gespeicherten
Bytes anzufassen.
