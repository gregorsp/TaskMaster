# TaskMaster

Gemeinsame Aufgabenverwaltung für ein Homelab — Aufgaben, Kalender, Planung; dazu Notizen, Tagebuch und Meditation. Dieses Glossar hält die Begriffe fest, mit denen über diese Domäne gesprochen wird.

## Erfassen

**Notiz**:
Eine eigenständige, zeitgestempelte Erfassung eines Gedankens — entweder selbst geschriebener Text oder eine Aufnahme mit Transkript. Sie gehört genau einem Menschen, ist für alle anderen unsichtbar, ist nicht Teil des Tagebuchs und kann später einer Aufgabe zugeordnet werden.
_Avoid_: Memo, Voice Memo, Diktat, Eintrag

**Aufnahme**:
Die Audiodatei zu einer Notiz, einem Tagebucheintrag, einer Antwort oder einer Meditations-Session, gespeichert so, wie das Gerät sie erzeugt hat.
_Avoid_: Audio, Datei, Recording, Clip

**Transkript**:
Die verschriftlichte Fassung einer Aufnahme, gegliedert in Segmente.
_Avoid_: Mitschrift, Protokoll, Abschrift

**Segment**:
Ein Satz oder Teilsatz eines Transkripts mit Anfangs- und Endzeit. Segmente tragen die Synchronisation zwischen Text und Aufnahme und lassen sich einzeln ändern, ohne ihre Zeit zu verlieren.
_Avoid_: Satz, Block, Absatz, Zeile

## Tagebuch

**Tagebuch**:
Die Gesamtheit der Einträge und Frage-Antworten eines Menschen, geordnet nach Tagen.
_Avoid_: Journal, Log

**Tagebucheintrag**:
Ein freier Text zu einem Tag, optional mit Aufnahme. Es gibt mehrere pro Tag; ein Eintrag lässt sich keiner Aufgabe zuordnen und ist nicht Teil der Notizen.
_Avoid_: Journal Entry, Notiz (für Tagebucheinträge)

**Frage**:
Eine selbst definierte Frage, die an jedem Tag beantwortet werden kann. Sie hat einen Text und eine Position und wird archiviert, nicht gelöscht.
_Avoid_: Prompt, Check-in, Vorlage

**Antwort**:
Die Antwort auf eine Frage an einem bestimmten Tag — genau eine pro Frage und Tag. Sie ist Freitext und kann aus einem Transkript entstanden sein.
_Avoid_: Response, Eintrag, Ausfüllung

## Meditation

**Meditations-Session**:
Eine Sitzung mit Beginn, Ende, tatsächlicher Dauer, optionaler geplanter Dauer und Notiz. Sie kann eine durchgehende Aufnahme besitzen und bleibt vom Tagebuch getrennt.
_Avoid_: Sitzung, Meditation, Session

## Verarbeitung

**Transkriptions-Job**:
Der Auftrag, eine Aufnahme zu transkribieren. Er liegt auf dem Server und wird von genau einem Gerät beansprucht.
_Avoid_: Task, Queue-Item, Auftrag
