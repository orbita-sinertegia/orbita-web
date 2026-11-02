-- NO EJECUTAR sin revisión de Tony.
-- Backfill de "phase" para tareas ya existentes (creadas antes de esta fase), para que
-- quede guardada en la base en vez de inferirse siempre en el cliente. Requiere haber
-- corrido primero sql/2026-10-22_hoja_ruta_cliente.sql (agrega la columna).
-- Espejo exacto de inferPhase()/TITLE_PHASE_MAP en src/data/projectTemplates.ts: primero
-- por título exacto (cubre el 100% de VSL/Webinar), y de respaldo por departamento para
-- cualquier tarea personalizada o de un embudo "otro" que no esté en esa lista.
begin;

update public.tasks set phase = case title
  -- Entrada
  when 'Llenar los 3 documentos' then 'entrada'
  when 'Crear grupo de WhatsApp con cliente y equipo' then 'entrada'
  when 'Enviar 3 documentos para llenar' then 'entrada'
  when 'Agendar reunión inicial con cliente y equipo' then 'entrada'
  when 'Recolección de accesos' then 'entrada'
  when 'Reunión con el equipo interno, para confirmar fechas de entrega' then 'entrada'
  when 'Revisar cuenta publicitaria y BM' then 'entrada'
  when 'Crear Pixel de Meta' then 'entrada'
  when 'Compartir Pixel a Web Master' then 'entrada'
  -- Estrategia
  when 'Crear carpeta de ChatGPT del cliente' then 'estrategia'
  when 'Subir archivo de Preguntas de Poder' then 'estrategia'
  when 'Subir ADN de Marca (si aplica)' then 'estrategia'
  when 'Subir el NTPVS a la carpeta del experto' then 'estrategia'
  when 'Hacer investigación en Comet (IG, TikTok, YT)' then 'estrategia'
  when 'Crear prompt experto: Mapa Emocional' then 'estrategia'
  -- Guiones
  when 'Reunión con el líder del proyecto para revisar guiones' then 'guiones'
  when 'Validar guiones VSL, Gracias, 12 anuncios' then 'guiones'
  when 'Agendar reunión con el cliente para el feedback y entrega de guiones' then 'guiones'
  when 'Entregar al cliente para feedback los guiones' then 'guiones'
  when 'Crear prompt experto: Guiones VSL y Gracias' then 'guiones'
  when 'Crear prompt: Meta Ads (guiones de video)' then 'guiones'
  -- Producción · Video (incluye extras de Webinar y las de modalidad)
  when 'Agendar sesión de grabación' then 'produccion_video'
  when 'Editar VSL principal' then 'produccion_video'
  when 'Editar video de Gracias' then 'produccion_video'
  when 'Editar 6 anuncios — ronda 1 (2 fríos, 2 templados, 2 calientes)' then 'produccion_video'
  when 'Editar 6 anuncios — ronda 2 (2 fríos, 2 templados, 2 calientes)' then 'produccion_video'
  when 'Encarpetar' then 'produccion_video'
  when 'Crear Presentación' then 'produccion_video'
  when 'Solicitar reunión de revisión de presentación con Alfredo Mota' then 'produccion_video'
  when 'Diseñar presentación de webinar (solo diseño, no estructura)' then 'produccion_video'
  when 'Video de Edificación - Presentación' then 'produccion_video'
  when 'Grabar 12 anuncios' then 'produccion_video'
  when 'Grabar VSL y Video de Gracias' then 'produccion_video'
  when 'Asistir a la sesión de grabación' then 'produccion_video'
  when 'Grabar VSL, Gracias y 12 anuncios' then 'produccion_video'
  when 'Compartir la grabación de video de VSL, Gracias, 12 anuncios' then 'produccion_video'
  when 'Enviar guía de grabación al cliente y revisar material recibido' then 'produccion_video'
  -- Legado (ya no se crea en proyectos nuevos, pero puede existir en proyectos viejos)
  when 'Grabar VSL de webinar, Gracias y 12 anuncios' then 'produccion_video'
  when 'Compartir la grabación' then 'produccion_video'
  -- Producción · Páginas (incluye extras de Webinar)
  when 'Montar funnel completo en GHL' then 'produccion_paginas'
  when 'Cambiar diseño visual de Pág. Gracias' then 'produccion_paginas'
  when 'Cambiar diseño visual y de texto a la Página de Oferta' then 'produccion_paginas'
  when 'Instalar "Pixel" de Meta ADS' then 'produccion_paginas'
  when 'Crear los "custom value" en GHL' then 'produccion_paginas'
  when 'Crear grupo de WhatsApp en Funnelchat' then 'produccion_paginas'
  when 'Crear la automatización de correos' then 'produccion_paginas'
  when 'Agregar los copys en correo' then 'produccion_paginas'
  when 'Agregar video de gracias y VSL' then 'produccion_paginas'
  when 'Programar los mensajes de WhatsApp en Funnelchat' then 'produccion_paginas'
  when 'Reset de timers de embudo' then 'produccion_paginas'
  when 'Crear prompt experto: LP' then 'produccion_paginas'
  when 'Crear prompt: Emails + WhatsApp' then 'produccion_paginas'
  when 'Entregar textos a la Diseñadora de páginas web' then 'produccion_paginas'
  when 'Entregar textos a la Web Master de Correo y WhatsApp' then 'produccion_paginas'
  when 'Crear prompt: Copy In / Out para Ads' then 'produccion_paginas'
  when 'Entregar textos de Copy In / Out para Ads a la diseñadora de ADS' then 'produccion_paginas'
  when 'Diseñar Landing Page (LP)' then 'produccion_paginas'
  when 'Diseñar Página de Gracias' then 'produccion_paginas'
  when 'Diseñar miniatura del video de LP y Gracias' then 'produccion_paginas'
  when 'Diseñar imagen mockup para WhatsApp en página de gracias' then 'produccion_paginas'
  when 'Diseñar imágenes para correos' then 'produccion_paginas'
  when 'Diseñar Mockup para página de Oferta' then 'produccion_paginas'
  when 'Diseñar imágenes para grupo de WhatsApp' then 'produccion_paginas'
  when 'Diseñar imágenes para mensajes de WhatsApp' then 'produccion_paginas'
  when 'Diseñar 3 imágenes tipo carruseles para Meta Ads' then 'produccion_paginas'
  when 'Diseñar 3 imágenes simples para Meta Ads' then 'produccion_paginas'
  when 'Cambiar diseño visual de Pág. Ingreso al Webinar' then 'produccion_paginas'
  when 'Crear el Evento en Addevent' then 'produccion_paginas'
  when 'Pág. Ingreso al Webinar' then 'produccion_paginas'
  when 'Addevent' then 'produccion_paginas'
  -- Revisión
  when 'Revisar el embudo con el equipo para dar check final' then 'revision'
  when 'Compartir con el equipo de BGI los links para autorizarlos' then 'revision'
  when 'Revisar con el equipo de webmaster el embudo completo' then 'revision'
  when 'Solicitar reunión con el experto para dar check final del embudo' then 'revision'
  when 'Solicitar revisión de embudo con el líder' then 'revision'
  -- Lanzamiento
  when 'Montar campañas en Meta Ads' then 'lanzamiento'
  when 'Lanzar campañas' then 'lanzamiento'
  else case department
    when 'cliente' then 'entrada'
    when 'lider' then 'entrada'
    when 'webmaster' then 'produccion_paginas'
    when 'copy' then 'estrategia'
    when 'diseno' then 'produccion_paginas'
    when 'edicion' then 'produccion_video'
    when 'trafficker' then 'lanzamiento'
    when 'grabacion' then 'produccion_video'
    else 'entrada'
  end
end
where phase is null;

commit;
