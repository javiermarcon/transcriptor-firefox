/**
 * Extracción heurística de participantes y hablante activo desde el DOM visible.
 * Las estrategias asumen atributos accesibles; Meet puede cambiar sin aviso.
 */
/* c8 ignore start */
(function (root, factory) {
  const api = factory(root.MeetingsMeetEventSchema);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MeetingsMeetDomSnapshot = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Schema) {
  /* c8 ignore stop */
  const NAME_NOISE =
    /^(you|tú|tu|me|yo|presenting|presentando|microphone|micrófono|camera|cámara|more options|más opciones)$/i;

  function normalizeName(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.replace(/\s+/g, " ").trim();
  }

  function looksLikePersonName(name) {
    const cleaned = normalizeName(name);
    if (!cleaned || cleaned.length < 2 || cleaned.length > 80) {
      return false;
    }
    if (NAME_NOISE.test(cleaned)) {
      return false;
    }
    if (/https?:\/\//i.test(cleaned)) {
      return false;
    }
    return /[\p{L}]/u.test(cleaned);
  }

  function participantKey(source, stableId, displayName) {
    if (stableId) {
      return `${source}:${stableId}`;
    }
    return `${source}:name:${displayName.toLowerCase()}`;
  }

  function textFromElement(el) {
    /* c8 ignore next 3 */
    if (!el) {
      return "";
    }
    const aria = normalizeName(
      el.getAttribute && el.getAttribute("aria-label")
    );
    if (aria) {
      return aria;
    }
    return normalizeName(el.textContent || "");
  }

  function collectByParticipantId(doc) {
    const schema = Schema;
    const nodes = doc.querySelectorAll
      ? Array.from(doc.querySelectorAll("[data-participant-id]"))
      : [];
    const participants = [];
    for (const node of nodes) {
      const id = normalizeName(node.getAttribute("data-participant-id"));
      let name = normalizeName(node.getAttribute("data-self-name"));
      if (!name) {
        const named = node.querySelector
          ? node.querySelector("[data-self-name], [aria-label], span, div")
          : null;
        name = normalizeName(
          (named &&
            (named.getAttribute("data-self-name") ||
              named.getAttribute("aria-label") ||
              named.textContent)) ||
            textFromElement(node)
        );
      }
      // Algunos tiles ponen el nombre solo en un hijo corto.
      if (!looksLikePersonName(name) && node.querySelectorAll) {
        for (const child of Array.from(node.querySelectorAll("*"))) {
          const candidate = normalizeName(
            child.getAttribute("data-self-name") ||
              child.getAttribute("aria-label") ||
              child.textContent
          );
          if (looksLikePersonName(candidate) && candidate.length < 60) {
            name = candidate;
            break;
          }
        }
      }
      if (!id || !looksLikePersonName(name)) {
        continue;
      }
      participants.push({
        key: participantKey(schema.SOURCES.DOM_PARTICIPANT_ID, id, name),
        display_name: name,
        stable_id: id,
        source: schema.SOURCES.DOM_PARTICIPANT_ID,
        confidence: 0.75,
        quality: "heuristic_unstable_selector",
      });
    }
    return participants;
  }

  function findPeopleLists(doc) {
    if (!doc.querySelectorAll) {
      return [];
    }
    return Array.from(
      doc.querySelectorAll('[role="list"], [data-participants-list="true"]')
    ).filter((list) => {
      if (list.getAttribute("data-participants-list") === "true") {
        return true;
      }
      const label = String(list.getAttribute("aria-label") || "").toLowerCase();
      return (
        label.includes("participant") ||
        label.includes("participante") ||
        label.includes("people") ||
        label.includes("personas")
      );
    });
  }

  function collectByPeopleList(doc) {
    const schema = Schema;
    const lists = findPeopleLists(doc);
    const participants = [];
    for (const list of lists) {
      const items = list.querySelectorAll
        ? Array.from(list.querySelectorAll('[role="listitem"], li'))
        : [];
      for (const item of items) {
        const name = textFromElement(item)
          .replace(/\b(muted|silenciado|presenting|presentando)\b/gi, "")
          .trim();
        if (!looksLikePersonName(name)) {
          continue;
        }
        participants.push({
          key: participantKey(schema.SOURCES.DOM_PEOPLE_LIST, null, name),
          display_name: name,
          stable_id: null,
          source: schema.SOURCES.DOM_PEOPLE_LIST,
          confidence: 0.55,
          quality: "heuristic_unstable_selector",
        });
      }
    }
    return participants;
  }

  function collectByAriaTiles(doc) {
    const schema = Schema;
    const nodes = doc.querySelectorAll
      ? Array.from(
          doc.querySelectorAll(
            '[data-participant-tile="true"], [data-allocation-index], [aria-label*="("]'
          )
        )
      : [];
    const participants = [];
    for (const node of nodes) {
      const label = textFromElement(node);
      // Etiquetas tipo "Ana Pérez (Presenting)" o "Ana Pérez".
      const name = normalizeName(label.split("(")[0]);
      if (!looksLikePersonName(name)) {
        continue;
      }
      participants.push({
        key: participantKey(schema.SOURCES.DOM_ARIA_TILE, null, name),
        display_name: name,
        stable_id: null,
        source: schema.SOURCES.DOM_ARIA_TILE,
        confidence: 0.4,
        quality: "low_heuristic",
      });
    }
    return participants;
  }

  function dedupeParticipants(list) {
    const byName = new Map();
    for (const participant of list) {
      const nameKey = participant.display_name.toLowerCase();
      const existing = byName.get(nameKey);
      if (!existing || participant.confidence > existing.confidence) {
        byName.set(nameKey, participant);
      }
    }
    return Array.from(byName.values()).sort((a, b) =>
      a.display_name.localeCompare(b.display_name)
    );
  }

  function detectActiveSpeaker(doc, participants) {
    const schema = Schema;
    const attrNodes = doc.querySelectorAll
      ? Array.from(
          doc.querySelectorAll(
            '[data-is-speaking="true"], [data-speaking="true"]'
          )
        )
      : [];
    const ariaNodes = doc.querySelectorAll
      ? Array.from(doc.querySelectorAll("[aria-label]")).filter((node) => {
          const label = String(
            node.getAttribute("aria-label") || ""
          ).toLowerCase();
          return label.includes("speaking") || label.includes("hablando");
        })
      : [];
    const speakingNodes = attrNodes.concat(ariaNodes);

    for (const node of speakingNodes) {
      const attrSpeaking =
        node.getAttribute("data-is-speaking") === "true" ||
        node.getAttribute("data-speaking") === "true";
      let name = normalizeName(node.getAttribute("data-self-name"));
      if (!name) {
        name = normalizeName(textFromElement(node).split("(")[0]);
      }
      name = name
        .replace(/\b(speaking|hablando|is speaking|está hablando)\b/gi, "")
        .trim();
      if (!looksLikePersonName(name)) {
        const matched = (participants || []).find((p) =>
          textFromElement(node)
            .toLowerCase()
            .includes(p.display_name.toLowerCase())
        );
        if (matched) {
          return {
            display_name: matched.display_name,
            participant_key: matched.key,
            source: attrSpeaking
              ? schema.SOURCES.DOM_SPEAKING_ATTR
              : schema.SOURCES.DOM_SPEAKING_ARIA,
            confidence: attrSpeaking ? 0.7 : 0.5,
            quality: "visual_indicator_only",
          };
        }
        continue;
      }
      const known = (participants || []).find(
        (p) => p.display_name.toLowerCase() === name.toLowerCase()
      );
      return {
        display_name: name,
        participant_key: known ? known.key : null,
        source: attrSpeaking
          ? schema.SOURCES.DOM_SPEAKING_ATTR
          : schema.SOURCES.DOM_SPEAKING_ARIA,
        confidence: attrSpeaking ? 0.7 : 0.5,
        quality: "visual_indicator_only",
      };
    }
    return null;
  }

  function findScopedRoot(doc) {
    const lists = findPeopleLists(doc);
    return lists[0] || null;
  }

  function captureMeetSnapshot(doc) {
    const byId = collectByParticipantId(doc);
    const byList = collectByPeopleList(doc);
    const byTiles = byId.length || byList.length ? [] : collectByAriaTiles(doc);
    const participants = dedupeParticipants(byId.concat(byList, byTiles));
    const activeSpeaker = detectActiveSpeaker(doc, participants);
    const strategy =
      byId.length > 0
        ? "dom_participant_id"
        : byList.length > 0
          ? "dom_people_list"
          : byTiles.length > 0
            ? "dom_aria_tile"
            : "none";

    return {
      captured_at_ms: Date.now(),
      strategy,
      participants,
      active_speaker: activeSpeaker,
      scoped_root_found: Boolean(findScopedRoot(doc)),
      participant_count: participants.length,
    };
  }

  return {
    captureMeetSnapshot,
    collectByParticipantId,
    collectByPeopleList,
    collectByAriaTiles,
    detectActiveSpeaker,
    findScopedRoot,
    findPeopleLists,
    looksLikePersonName,
    normalizeName,
    dedupeParticipants,
  };
});
