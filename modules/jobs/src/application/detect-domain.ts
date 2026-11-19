import {
  detectDomainRequest,
  InvalidCitation,
  SchemaMismatch,
  UncitedOutput,
  type AiClient,
  type Citation,
  type Source,
} from '@aivera/ai';
import { DOMAIN_KEYS, REGIONS, type DomainKey, type Region } from '../domain/domain-packs.ts';
import type { JobType } from '../domain/job-types.ts';

// "Detect the job's industry" (AIV-P1-063, ADR-006): runs beside "Draft competencies" (AIV-P1-008) under the same
// citation contract. The industry is the hiring company's, read from the job's own text: never about a candidate.
// Nothing is saved here; AIV-P1-064 shows the result and the recruiter keeps or drops each suggestion.

export type DetectDomainInput = { jobType: JobType; title: string; description: string; location: string | null };

/** The hiring company's likely industry and the job's regions, each with the job text it rests on. */
export type DomainDetection = {
  /** `none` when no industry is clear: the job gets its job type's starters only, and no pack is suggested. */
  domain: DomainKey | 'none';
  /** The description spans the domain rests on; empty when `domain` is `none`. */
  citations: Citation[];
  /** Each region cites the location (source id `location`) or the description (source id `description`). */
  regions: { region: Region; citations: Citation[] }[];
};

const NONE: DomainDetection = { domain: 'none', citations: [], regions: [] };

export function domainDetection(ai: Pick<AiClient, 'generateStructured'>) {
  return {
    async detectDomain(workspaceId: string, input: DetectDomainInput): Promise<DomainDetection> {
      // The location is its own source, so a region can cite it apart from the description.
      const sources: Source[] = [{ id: 'description', kind: 'job_description', text: input.description }];
      if (input.location?.trim()) sources.push({ id: 'location', kind: 'job_description', text: input.location });
      try {
        const { industry, regions } = await ai.generateStructured({
          ...detectDomainRequest(input, { domains: DOMAIN_KEYS, regions: REGIONS }, sources),
          workspaceId,
        });
        return {
          domain: industry.domain,
          citations: 'citations' in industry ? industry.citations : [],
          // shortcut: a region citing a line about the people to hire (nationality, residency) is not rejected in code;
          // the prompt forbids it and the eval safety case gates it. Upgrade if AIV-P1-066 shows a miss.
          regions: regions.map((r) => ({ region: r.region, citations: r.citations })),
        };
      } catch (error) {
        // An answer the contract rejected twice (an invented domain or quote) is no detection; outages still throw.
        if (error instanceof SchemaMismatch || error instanceof UncitedOutput || error instanceof InvalidCitation)
          return NONE;
        throw error;
      }
    },
  };
}
