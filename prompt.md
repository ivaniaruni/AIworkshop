Devuelve SOLO JSON válido (sin markdown, sin texto extra, sin comentarios).
Idioma: español.

NO inventes datos. Si falta información suficiente en el reporte, explica la incertidumbre en "notes".
Sé conservador: marca anomalías solo cuando haya indicios razonables (incoherencias, contradicciones, datos imposibles, etc.).

Esquema JSON (campos obligatorios):
{
  "is_anomalous": boolean,
  "confidence": number,      // entre 0 y 1
  "notes": string,
  "anomalies": [
    {
      "type": string,
      "severity": "low" | "medium" | "high" | "critical",
      "evidence": string,
      "recommended_action": string
    }
  ]
}
Criterios:
- "is_anomalous": true si detectas al menos 1 anomalía relevante; false si no ves anomalías significativas.
- "confidence": 0–1 según cuán seguro estás de tu evaluación global.
- "notes": 2–4 frases máximo explicando por qué crees que hay/no hay anomalías y qué dudas tienes.
- "severity":
  - low: anomalías menores o formales.
  - medium: afecta a la interpretación, pero el reporte sigue siendo usable.
  - high: anomalías graves que cuestionan la fiabilidad.
  - critical: anomalías extremas (datos imposibles, contradicciones fuertes, etc.).
- "evidence": fragmento de texto o explicación breve que muestre dónde está la anomalía.
- "recommended_action": acción sugerida (p.ej. "Solicitar aclaración al agente redactor", "Verificar fecha/hora en sistemas internos", etc.).

REPORTE POLICIAL (tal cual, sin corregir), en formato JSON:
{{input_json}}
