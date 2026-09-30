import type { ActionRunContext } from "@agent-native/core/action";

import type { BoardResult, EngagementDetail } from "../../shared/pa-views.js";
import { quoteUntrusted } from "../core/untrusted/index.js";

/** UI callers render untrusted text as escaped React text; every other caller gets quoted data. */
export function isAgentFacing(ctx: ActionRunContext | undefined): boolean {
  return ctx?.caller !== "frontend";
}

const quote = (text: string | null, max = 600) =>
  text === null ? null : quoteUntrusted(text, max);

// Form name and company are stranger-written too (SPEC 14).
const quoteLead = <T extends { name: string | null; company: string | null }>(
  lead: T,
): T => ({
  ...lead,
  name: quote(lead.name, 120),
  company: quote(lead.company, 120),
});

export function quoteBoard(board: BoardResult): BoardResult {
  return {
    ...board,
    rows: board.rows.map((row) => ({
      ...row,
      lead: quoteLead(row.lead),
      asked: quote(row.asked, 300),
    })),
  };
}

export function quoteDetail(detail: EngagementDetail): EngagementDetail {
  return {
    ...detail,
    lead: quoteLead(detail.lead),
    draft: {
      ...detail.draft,
      to: { ...detail.draft.to, name: quote(detail.draft.to.name, 120) },
    },
    submissions: detail.submissions.map((submission) => ({
      ...submission,
      message: quote(submission.message, 2000),
      flags: submission.flags.map((flag) => ({
        ...flag,
        text: quoteUntrusted(flag.text, 200),
      })),
    })),
    assessment: detail.assessment
      ? {
          ...detail.assessment,
          explicitQuestion: quote(detail.assessment.explicitQuestion),
          evidenceQuotes: detail.assessment.evidenceQuotes.map((item) =>
            quoteUntrusted(item, 400),
          ),
        }
      : null,
    scorecard: detail.scorecard
      ? {
          ...detail.scorecard,
          answers: detail.scorecard.answers.map((answer) =>
            answer.source?.quote
              ? {
                  ...answer,
                  answer:
                    answer.answer === answer.source.quote
                      ? quoteUntrusted(answer.answer, 400)
                      : answer.answer,
                  source: {
                    ...answer.source,
                    quote: quoteUntrusted(answer.source.quote, 400),
                  },
                }
              : answer,
          ),
        }
      : null,
  };
}
