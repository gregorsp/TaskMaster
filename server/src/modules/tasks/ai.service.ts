import { config } from "../../config.js";

export async function generateGtdDescription(title: string, currentDescription?: string, userApiKey?: string): Promise<string> {
  const prompt = `Du bist ein GTD-Experte nach David Allen.
Aufgabentitel: "${title}"
${currentDescription ? `Bisherige Notizen: "${currentDescription}"` : ""}

Erstelle eine kurze, strukturierte Aufgabenbeschreibung auf Deutsch mit genau diesen vier Punkten:
1. GTD-Kategorie & Begründung (Wähle zwischen „Projekte“, „Nächste Schritte“, „Warten auf“ oder „Irgendwann/Vielleicht“ und erkläre in 1–2 Sätzen nach David Allen, warum diese Kategorie passt)
2. Zielbild (Was ist das fertige Ergebnis?)
3. Nächster physischer Schritt (Konkrete erste Handlung mit @Kontext wie @Telefon, @Computer, @Online, @Zuhause)
4. Checkliste / Unterpunkte (2-4 kurze Stichpunkte)

Antworte direkt mit dem fertigen Text ohne Einleitung.`;

  const key = (userApiKey || "").trim();
  const geminiKey = ((key.startsWith("AIza") || key.startsWith("AQ.")) || key.startsWith("AQ.")) ? key : (!key ? config.geminiApiKey : undefined);
  const deepseekKey = key && !((key.startsWith("AIza") || key.startsWith("AQ.")) || key.startsWith("AQ.")) ? key : (!key ? config.deepseekApiKey : undefined);

  if (geminiKey) {
    const url = "https://" + "generativelanguage.googleapis" + ".com/v1beta/models/gemini-2.5-flash:generateContent";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": geminiKey,
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) throw new Error(`Gemini API Fehler (${res.status}): ${await res.text()}`);
    const data: any = await res.json();
    const text = data?.candidates?.at(0)?.content?.parts?.at(0)?.text;
    if (!text) throw new Error("Leere Antwort von Gemini.");
    return String(text).trim();
  }

  if (deepseekKey) {
    const url = "https://" + "api.deepseek" + ".com/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${deepseekKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error(`DeepSeek API Fehler (${res.status}): ${await res.text()}`);
    const data: any = await res.json();
    const text = data?.choices?.at(0)?.message?.content;
    if (!text) throw new Error("Leere Antwort von DeepSeek.");
    return String(text).trim();
  }

  throw new Error("Kein API-Key hinterlegt.");
}
export async function generateMindmapIdeas(topic: string, userApiKey?: string): Promise<string[]> {
  const prompt = `Du bist ein GTD-Produktivitätsexperte nach David Allen.
Projektthema: "${topic}"

Nenne genau 5 konkrete, kurze nächste physische Schritte (jeweils maximal 5 Wörter, ohne Nummerierung, ohne Aufzählungszeichen, gerne mit @Kontext wie @Computer, @Telefon, @Online, @Besorgungen), um dieses Projekt umzusetzen.
Antworte nur mit den 5 Zeilen, eine Aufgabe pro Zeile.`;

  const key = (userApiKey || "").trim();
  const isGemini = key.startsWith("AIza") || key.startsWith("AQ.");
  const geminiKey = isGemini ? key : (!key ? config.geminiApiKey : undefined);
  const deepseekKey = (key && !isGemini) ? key : (!key ? config.deepseekApiKey : undefined);

  let rawText = "";
  if (geminiKey) {
    const url = "https://" + "generativelanguage.googleapis" + ".com/v1beta/models/gemini-2.5-flash:generateContent";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) throw new Error(`Gemini Fehler (${res.status})`);
    const data: any = await res.json();
    rawText = data?.candidates?.at(0)?.content?.parts?.at(0)?.text || "";
  } else if (deepseekKey) {
    const url = "https://" + "api.deepseek" + ".com/chat/completions";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${deepseekKey}` },
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: prompt }], temperature: 0.4 }),
    });
    if (!res.ok) throw new Error(`DeepSeek Fehler (${res.status})`);
    const data: any = await res.json();
    rawText = data?.choices?.at(0)?.message?.content || "";
  } else {
    throw new Error("Kein API-Key hinterlegt.");
  }

  return rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\d\.\-\*\•\s]+/, "").trim())
    .filter((line) => line.length > 1)
    .slice(0, 6);
}