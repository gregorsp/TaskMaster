# Transkription läuft auf den Geräten, der Server speichert nur

Der Server ist ein Raspberry Pi 5 mit 8 GB, auf dem das Budget bewusst bei 1 GB liegt, und das Projekt
vermeidet native Abhängigkeiten, damit das Image ohne Kompilier-Toolchain auf ARM64 läuft. Ein
Sprachmodell auf dem Pi hieße: native Laufzeit, Modell auf der Platte, 1,5–2 GB Speicherspitze — und
eine Warteschlange, die auf genau ein Gerät wartet. Deshalb transkribieren ausschließlich die Clients;
der Server hält Aufnahmen, Segmente und den Job-Status, und ein Job wird von genau einem Gerät
beansprucht.

Folge: Transkripte können warten, bis ein fähiges Gerät die App öffnet. Es gibt keinen Server-Fallback
und keinen Cloud-Dienst — der Preis dafür ist, dass eine Aufnahme ohne fähiges Gerät untranskribiert
bleibt.

**Teilweise ersetzt durch [ADR 0003](0003-server-transkription-nachts.md):** Es gibt jetzt einen
Server-Fallback für die Nacht (lokal, kein Cloud-Dienst). „Kein Cloud-Dienst" gilt weiter, das
1-GB-Budget nicht mehr — während eines Laufs sind es 1,5–2 GB.
