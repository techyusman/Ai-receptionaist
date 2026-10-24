import { faqInput, pronunciationInput, type Faq, type Pronunciation } from "@receptionist/contracts";
import { many, maybeOne, one, type Tx } from "@receptionist/db";
import type { FastifyInstance } from "fastify";
import { audit } from "../audit.ts";
import type { Deps } from "../deps.ts";
import { conflict, notFound, rule } from "../errors.ts";
import { idParam, lidParam, meta, parse, who } from "../http.ts";
import { tenant } from "./util.ts";

type FaqRow = {
  id: string; question: string; question_aliases: string[]; answer: string; active: boolean; valid_from: string | null;
  valid_until: string | null; source: Faq["source"]; reviewed: boolean; updated_at: string;
};
const FAQ_COLUMNS = "id, question, question_aliases, answer, active, valid_from, valid_until, source, reviewed, updated_at";
const toFaq = (r: FaqRow): Faq => ({
  id: r.id, question: r.question, aliases: r.question_aliases, answer: r.answer, active: r.active, validFrom: r.valid_from,
  validUntil: r.valid_until, source: r.source, reviewed: r.reviewed, updatedAt: r.updated_at,
});

/** Same question, ignoring case and trailing punctuation. One question, one answer, so the AI never has to pick. */
const SAME_QUESTION = "lower(regexp_replace(question, '[?.![:space:]]+$', ''))";
const normalise = (q: string) => q.trim().toLowerCase().replace(/[?.!\s]+$/, "");

// Starter questions arrive as drafts: the [brackets] must be replaced with the restaurant's own words.
const STARTERS: [string, string][] = [
  ["Do you have vegan options?", "[Which items are vegan, or how to ask for a swap.]"],
  ["Is there step-free access?", "[Entrance, ramps, accessible restroom.]"],
  ["Can I bring my laptop and work?", "[Your policy on laptops, outlets and time limits.]"],
  ["Do you sell gift cards?", "[Whether you sell them and where.]"],
  ["Can I order for a large group?", "[How far ahead, and who to call for catering.]"],
];

async function assertNoDuplicate(tx: Tx, locationId: string, question: string, exceptId?: string) {
  const dup = await maybeOne(tx, `select id from faqs where location_id = $1 and ${SAME_QUESTION} = $2 and ($3::uuid is null or id <> $3)`, [locationId, normalise(question), exceptId ?? null]);
  if (dup) throw conflict("You already have this question. Edit that one instead, so the AI has one answer.", "question");
}

export function registerKnowledgeRoutes(api: FastifyInstance, deps: Deps) {
  api.get("/locations/:lid/faqs", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid);
    return tenant(deps, a, async (tx) => (await many<FaqRow>(tx, `select ${FAQ_COLUMNS} from faqs where location_id = $1 order by created_at desc`, [lid])).map(toFaq));
  });

  api.post("/locations/:lid/faqs", async (req, reply) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "knowledge.edit");
    const input = parse(faqInput, req.body);
    if (/\[[^\]]+\]/.test(input.answer)) throw rule("Replace the [bracketed] text with your own answer first.", "answer");
    const faq = await tenant(deps, a, async (tx) => {
      await assertNoDuplicate(tx, lid, input.question);
      const r = await one<FaqRow>(
        tx,
        `insert into faqs (restaurant_id, location_id, question, question_aliases, answer, active, valid_from, valid_until, source, reviewed, updated_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'MANUAL', true, $9) returning ${FAQ_COLUMNS}`,
        [a.restaurantId, lid, input.question, input.aliases, input.answer, input.active, input.validFrom, input.validUntil, a.userId],
      );
      await audit(tx, a, meta(req), { action: "faqs.create", targetType: "faq", targetId: r.id, target: "Knowledge", summary: `Added “${input.question}”.` });
      return toFaq(r);
    });
    return reply.status(201).send(faq);
  });

  // Edit in place: one entry keeps one id, so nothing stale lingers next to a newer answer.
  api.put("/faqs/:id", async (req) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "faq", id, "knowledge.edit");
    const input = parse(faqInput, req.body);
    if (/\[[^\]]+\]/.test(input.answer)) throw rule("Replace the [bracketed] text with your own answer first.", "answer");
    return tenant(deps, a, async (tx) => {
      await assertNoDuplicate(tx, a.locationId, input.question, id);
      const r = await maybeOne<FaqRow>(
        tx,
        `update faqs set question = $2, question_aliases = $3, answer = $4, active = $5, valid_from = $6, valid_until = $7,
                reviewed = true, updated_by = $8 where id = $1 returning ${FAQ_COLUMNS}`,
        [id, input.question, input.aliases, input.answer, input.active, input.validFrom, input.validUntil, a.userId],
      );
      if (!r) throw notFound();
      await audit(tx, a, meta(req), { action: "faqs.update", targetType: "faq", targetId: id, target: "Knowledge", summary: `Edited “${input.question}”.` });
      return toFaq(r);
    });
  });

  api.delete("/faqs/:id", async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const a = await deps.access.forResource(who(req), "faq", id, "knowledge.edit");
    await tenant(deps, a, async (tx) => {
      const gone = await maybeOne<{ question: string }>(tx, "delete from faqs where id = $1 returning question", [id]);
      if (gone) await audit(tx, a, meta(req), { action: "faqs.delete", targetType: "faq", targetId: id, target: "Knowledge", summary: `Deleted “${gone.question}”.` });
    });
    return reply.status(204).send();
  });

  api.post("/locations/:lid/faqs/templates", async (req) => {
    const { lid } = parse(lidParam, req.params);
    const a = await deps.access.forLocation(who(req), lid, "knowledge.edit");
    return tenant(deps, a, async (tx) => {
      let added = 0;
      for (const [question, answer] of STARTERS) {
        const dup = await maybeOne(tx, `select id from faqs where location_id = $1 and ${SAME_QUESTION} = $2`, [lid, normalise(question)]);
        if (dup) continue;
        await tx.query(
          `insert into faqs (restaurant_id, location_id, question, answer, active, source, reviewed, updated_by)
           values ($1, $2, $3, $4, false, 'TEMPLATE', false, $5)`,
          [a.restaurantId, lid, question, answer, a.userId],
        );
        added++;
      }
      await audit(tx, a, meta(req), { action: "faqs.templates", targetType: "location", targetId: lid, target: "Knowledge", summary: `Added ${added} starter questions as drafts.` });
      return { added };
    });
  });
}
