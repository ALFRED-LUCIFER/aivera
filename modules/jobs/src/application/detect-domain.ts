import {
  detectDomainRequest,
  InvalidCitation,
  SchemaMismatch,
  UncitedOutput,
  type AiClient,
  type Citation,
  type Source,
} from '@aivera/ai';
import type { CatalogueVersion } from '../domain/catalogue.ts';

// "Detect the job's industry" (AIV-P1-063, ADR-006): runs beside "Draft competencies" (AIV-P1-008) under the same
// citation contract. The industry is the hiring company's, read from the job's own text: never about a candidate.
// Nothing is saved here; AIV-P1-064 shows the result and the recruiter keeps or drops each suggestion.

export type DetectDomainInput = { jobType: string; title: string; description: string; location: string | null };

/** The hiring company's likely industry and the job's regions, each with the job text it rests on. */
export type DomainDetection = {
  /**
   * A pack key of the catalogue the call was given, or `none` when no industry is clear: the job gets its job type's
   * starters only, and no pack is suggested.
   */
  domain: string;
  /** The description spans the domain rests on; empty when `domain` is `none`. */
  citations: Citation[];
  /** Each region cites the location (source id `location`) or the description (source id `description`). */
  regions: { region: string; citations: Citation[] }[];
};

const NONE: DomainDetection = { domain: 'none', citations: [], regions: [] };

const offered = (entries: readonly { key: string; retired: boolean }[]) =>
  entries.filter((e) => !e.retired).map((e) => e.key);

export function domainDetection(ai: Pick<AiClient, 'generateStructured'>) {
  return {
    /** Detects against `catalogue`'s packs and regions not retired: the published version (ADR-013 point 15). */
    async detectDomain(
      workspaceId: string,
      input: DetectDomainInput,
      catalogue: CatalogueVersion,
    ): Promise<DomainDetection> {
      // The location is its own source, so a region can cite it apart from the description.
      const sources: Source[] = [{ id: 'description', kind: 'job_description', text: input.description }];
      if (input.location?.trim()) sources.push({ id: 'location', kind: 'job_description', text: input.location });
      const [domain, ...domains] = offered(catalogue.packs);
      const [region, ...regions] = offered(catalogue.regions);
      // Nothing to detect against (every pack or every region retired): no model call, no industry.
      if (!domain || !region) return NONE;
      try {
        const answer = await ai.generateStructured({
          ...detectDomainRequest(input, { domains: [domain, ...domains], regions: [region, ...regions] }, sources),
          catalogueVersion: catalogue.version,
          workspaceId,
        });
        const { industry } = answer;
        return {
          domain: industry.domain,
          citations: 'citations' in industry ? industry.citations : [],
          // shortcut: a region citing a line about the people to hire (nationality, residency) is not rejected in code;
          // the prompt forbids it and the eval safety case gates it. Upgrade if AIV-P1-066 shows a miss.
          regions: answer.regions.map((r) => ({ region: r.region, citations: r.citations })),
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
