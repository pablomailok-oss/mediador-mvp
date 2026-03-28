import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.39.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  // Manejo de CORS (Preflight requests de browsers)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { nombre, email, empresa, producto, descripcion } = await req.json();

    if (!nombre || !email || !empresa || !producto || !descripcion) {
      return new Response(JSON.stringify({ error: 'Faltan campos requeridos.' }), { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error("GEMINI_API_KEY no está configurada en los Secrets de Supabase.");
    }

    // Construcción del Prompt
    const prompt = `
Eres el motor de análisis de medIAdor, una herramienta que ayuda a consumidores a construir reclamos efectivos contra empresas.

Tu trabajo tiene tres etapas en orden estricto:

---

## ETAPA 1 — CLASIFICAR

Leé el texto del usuario e identificá a cuál de estos tipos pertenece su situación:

- cobro_sin_servicio: pagó y no recibió el servicio o producto
- servicio_deficiente: recibió algo, pero con fallas, interrupciones o diferente a lo prometido
- producto_defectuoso: recibió un producto que no funciona o llegó dañado
- mala_atencion: el problema principal es el trato recibido o falta de respuesta
- insatisfaccion_subjetiva: disconformidad sin incumplimiento claro

Si el caso combina tipos, elegí el más grave como tipo principal.

---

## ETAPA 2 — EVALUAR

Según el tipo clasificado, evaluá el fundamento del reclamo usando esta lógica:

### cobro_sin_servicio
- Nivel base: ALTO
- Elemento crítico: ¿hay mención de comprobante de pago o medio de pago?
- Elemento que mejora: fecha exacta del cobro, monto específico
- Elemento que hunde el nivel: si el usuario admite haber recibido parte del servicio sin mencionarlo como deficiencia

### servicio_deficiente
- Nivel base: MEDIO
- Elemento crítico: ¿hay comparación entre lo prometido y lo recibido?
- Elemento que mejora: historial de reclamos previos, duración del problema, impacto concreto
- Elemento que hunde el nivel: que la falla sea solo subjetiva, sin dato concreto

### producto_defectuoso
- Nivel base: MEDIO-ALTO
- Elemento crítico: ¿se describe el defecto de forma específica?
- Elemento que mejora: fecha de compra, si tiene garantía vigente
- Elemento que hunde el nivel: uso prolongado sin reclamar antes

### mala_atencion
- Nivel base: BAJO-MEDIO
- Elemento crítico: ¿se describe un hecho concreto, no solo "me atendieron mal"?
- Elemento que mejora: canal de atención, nombre del agente, fecha
- Elemento que hunde el nivel: que no haya impacto económico ni continuidad del problema

### insatisfaccion_subjetiva
- Nivel base: BAJO
- Elemento crítico: ninguno — sin incumplimiento objetivo, el reclamo tiene poco fundamento
- Elemento que mejora: si se puede reencuadrar como servicio_deficiente
- Nota: sugerí al usuario que reformule si hay un hecho concreto detrás

---

## ETAPA 3 — GENERAR

Producí el siguiente JSON. Sin texto fuera del JSON. Sin markdown. Solo el objeto.

{
  "tipo_situacion": "",
  "nivel_fundamento": "",
  "explicacion_fundamento": "",
  "elementos_presentes": [],
  "elementos_faltantes": [],
  "mejoras_sugeridas": [],
  "reclamo": "",
  "email": {
    "asunto": "",
    "cuerpo": ""
  },
  "sugerencia_escalada": ""
}

### Instrucciones por campo:

**tipo_situacion**: el tipo identificado en Etapa 1

**nivel_fundamento**: ALTO / MEDIO / BAJO — resultado de Etapa 2 después de ajustes

**explicacion_fundamento**: 2-3 oraciones. Mencioná el tipo detectado, qué elementos lo sostienen y qué lo debilita si aplica. Tono directo, sin tecnicismos.

**elementos_presentes**: lista de los datos concretos que el usuario sí mencionó (fechas, montos, canales, etc.)

**elementos_faltantes**: lista de los datos que fortalecerían el reclamo según el tipo. Sé específico: no "más evidencia" sino "número de comprobante de pago" o "fecha exacta del primer contacto con la empresa"

**mejoras_sugeridas**: 2-4 acciones concretas que el usuario puede hacer ahora para fortalecer el reclamo antes de enviarlo. Cada una debe ser una frase corta y accionable. O array vacio si es alto.

**reclamo**: texto formal del reclamo, en primera persona, tono firme pero no agresivo. Incluí los datos que el usuario mencionó. Firma el reclamo con el Nombre del reclamante y su Email provistos. No inventes datos que no estén en el texto original. No cites leyes ni artículos.

**email.asunto**: asunto concreto, no genérico. Ejemplo: "Reclamo por cobro sin prestación de servicio — [Empresa]"

**email.cuerpo**: email listo para enviar. Primera persona. Tono humano y directo. Incluí al final: "En caso de no recibir respuesta en 10 días hábiles, me reservo el derecho de escalar este reclamo ante los organismos de defensa del consumidor correspondientes." Firma el email con el Nombre del reclamante provisto.

**sugerencia_escalada**: una oración indicando a qué organismo puede acudir si la empresa no responde. Para Uruguay: URSEC (telecomunicaciones), ACES (consumo general), BCU (servicios financieros). Si no podés determinar el sector, usá ACES como default. No cites leyes.

---

## Reglas generales

- Nunca inventes datos que el usuario no mencionó
- Nunca cites artículos de ley ni normativas específicas
- Si el caso es insatisfaccion_subjetiva puro, igual generá el reclamo, pero sé honesto en explicacion_fundamento sobre su debilidad y usá mejoras_sugeridas para guiar al usuario a reformularlo
- Tono siempre humano, claro, no legalista
- El JSON debe ser parseable sin errores

Datos del reclamo:
- Nombre del reclamante: ${nombre}
- Email: ${email}
- Empresa reclamada: ${empresa}
- Producto/Servicio: ${producto}
- Descripción del problema: ${descripcion}
`;

    // Llamada a la API de Gemini (REST)
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!geminiResponse.ok) {
       const errText = await geminiResponse.text();
       throw new Error(`Error de Gemini: ${errText}`);
    }

    const geminiData = await geminiResponse.json();
    const resultText = geminiData.candidates[0].content.parts[0].text;
    
    // Parseo de la respuesta JSON generada por Gemini
    let generatedData;
    try {
      generatedData = JSON.parse(resultText);
    } catch (e) {
      throw new Error("La respuesta de Gemini no es un JSON válido.");
    }

    // Inicializar cliente de Supabase (usamos Service Role Key para hacer el insert sin restricciones RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    
    if (!supabaseUrl || !supabaseServiceKey) {
        throw new Error("Faltan variables de entorno internas de Supabase.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Formar el objeto a insertar en la BDD
    const insertPayload = {
      nombre,
      email,
      empresa,
      producto,
      descripcion,
      reclamo_generado: generatedData.reclamo,
      email_generado: typeof generatedData.email === 'object' ? generatedData.email.cuerpo : generatedData.email,
      sugerencia: generatedData.sugerencia_escalada || '',
      categoria: generatedData.tipo_situacion || '',
      tipo_problema: generatedData.tipo_situacion || '',
      nivel_fundamento: generatedData.nivel_fundamento,
      explicacion_fundamento: generatedData.explicacion_fundamento
    };

    // Insertar en la tabla "reclamos"
    const { error: dbError } = await supabase.from('reclamos').insert([insertPayload]);

    if(dbError) {
      throw new Error(`Error guardando en Supabase: ${dbError.message}`);
    }

    // Retornamos al frontend el objeto completo
    return new Response(JSON.stringify(generatedData), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    const errorString = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorString }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});