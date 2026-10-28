# Corpus sources

The service indexes every `*.md`, `*.txt` and `*.pdf` file in this folder (this file is skipped).

| File | Regulator | Source document (free, public) |
|---|---|---|
| `sebi_scores_circular_2023.md` | SEBI | SEBI circular SEBI/HO/OIAE/IGRD/P/CIR/2023/156 (20 Sep 2023) on SCORES, plus the "matters not dealt with as complaints" list published with SCORES |
| `sebi_mutual_funds_regulations.md` | SEBI | SEBI (Mutual Funds) Regulations, 1996: the provisions on investor servicing, read with the SEBI Master Circular for Mutual Funds |
| `sebi_lodr_and_market_intermediaries.md` | SEBI | SEBI LODR Regulations 2015 (Reg. 13); grievance obligations of stock brokers, depository participants and RTAs |
| `rbi_integrated_ombudsman_scheme_2021.md` | RBI | Reserve Bank Integrated Ombudsman Scheme, 2021, and RBI's public FAQs on the Scheme |

## Important: these are condensed excerpts

The build container could not reach sebi.gov.in or rbi.org.in, so the committed corpus is a set of
**condensed excerpts** written by the team from the public documents. Each clause is marked with a
clause label (for example `RBI-IOS/Cl-8`) and machine-readable metadata:

```
## [CLAUSE-ID] Heading
<!-- kind=scope|exclusion|timeline|procedure|obligation; covers=...; excludes=...; modifies=OTHER-ID -->
```

The clause labels follow the official numbering where we know it. **Check paragraph numbers, timelines
and circular numbers against the official text before you rely on them.** To index the official PDFs,
put them in this folder and run `docker compose run --rm indexer`. The pipeline reads PDFs that have a
text layer. Scanned PDFs need OCR first (for example `ocrmypdf in.pdf out.pdf`).

## Passages that the difficult case (section 4.1) depends on

| Role in the reasoning | Clause |
|---|---|
| Looks like it applies, because the complaint names SEBI and uses the word "invested" | `SEBI-SCORES/2` |
| The provision that changes the answer: banking products such as fixed deposits are excluded | `SEBI-SCORES/Annex-A` (e) |
| The framework that does cover the product and the entity | `RBI-IOS/Cl-3`, `RBI-IOS/FAQ-Deposits` |
| The ground of complaint: interest not paid at the agreed rate | `RBI-IOS/Cl-8` |
| The precondition for an RBI referral: approach the bank first and give it 30 days | `RBI-IOS/Cl-10` |

Reference answer: `refer_to_other_regulator`, regulator `RBI`, scheme RB-IOS 2021, entity type `bank`.
The investor must first complain in writing to the bank. If the bank does not reply within 30 days,
or the reply is unsatisfactory, the investor can go to the RBI Ombudsman.
