/** @jsxImportSource react */

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, BookOpen, HelpCircle, Search, X } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { usePlatform } from "@/react-app/kernel/platform";
import { searchFaqItems } from "@/app/lib/faq";

import { faqDocument } from "./faq-source";

const DOCS_BASE_URL = "https://ipollowork.dev/docs";

function helpReturnPath(state: unknown): string {
  if (!state || typeof state !== "object" || !("returnTo" in state)) return "/session";
  const returnTo = state.returnTo;
  return typeof returnTo === "string" && returnTo.startsWith("/") ? returnTo : "/session";
}

function docsUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${DOCS_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function AnswerText({ children }: { children: string }) {
  return (
    <p className="text-[14px] leading-7 text-foreground/85">
      {children.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) => (
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={`${part}-${index}`} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      ))}
    </p>
  );
}

export function HelpRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  const platform = usePlatform();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const requestedCategory = searchParams.get("category");
  const category = requestedCategory && faqDocument.categories.includes(requestedCategory)
    ? requestedCategory
    : null;
  const hashId = location.hash.replace(/^#/, "");
  const [openItems, setOpenItems] = useState<string[]>(hashId ? [hashId] : []);
  const filteredItems = useMemo(
    () => searchFaqItems(faqDocument.items, query, category),
    [category, query],
  );

  useEffect(() => {
    if (!hashId || !faqDocument.items.some((item) => item.id === hashId)) return;
    setOpenItems((current) => current.includes(hashId) ? current : [...current, hashId]);
    window.requestAnimationFrame(() => {
      document.getElementById(hashId)?.scrollIntoView({ block: "center" });
    });
  }, [hashId]);

  const updateSearchParam = (key: "q" | "category", value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const handleOpenItemsChange = (values: string[]) => {
    setOpenItems(values);
    const latest = values.at(-1);
    if (!latest || latest === hashId) return;
    navigate(
      { pathname: location.pathname, search: location.search, hash: `#${latest}` },
      { replace: true, state: location.state },
    );
  };

  const close = () => navigate(helpReturnPath(location.state));

  return (
    <div className="flex h-dvh min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3 md:px-5 mac:titlebar-drag">
        <div className="flex min-w-0 items-center gap-2 mac:titlebar-no-drag">
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label={t("help.back")}>
            <ArrowLeft className="size-4" />
          </Button>
          <HelpCircle className="size-4 text-primary" />
          <h1 className="truncate text-sm font-semibold">{t("help.title")}</h1>
          <Badge variant="secondary" className="hidden sm:inline-flex">{faqDocument.items.length}</Badge>
        </div>
        <div className="flex items-center gap-1 mac:titlebar-no-drag">
          <Button variant="ghost" size="sm" onClick={() => platform.openLink(DOCS_BASE_URL)}>
            <BookOpen className="size-4" />
            <span className="hidden sm:inline">{t("help.open_docs")}</span>
            <ArrowUpRight className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={close} aria-label={t("common.close")}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto">
        <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-9">
          <section className="min-w-0 rounded-3xl border border-border bg-[radial-gradient(circle_at_top_left,rgba(74,111,255,0.16),transparent_42%),var(--card)] p-5 shadow-sm md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">iPolloWork FAQ</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">{t("help.heading")}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{t("help.description")}</p>
            <div className="relative mt-5 min-w-0 max-w-2xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => updateSearchParam("q", event.currentTarget.value)}
                placeholder={t("help.search_placeholder")}
                aria-label={t("help.search_placeholder")}
                className="h-11 rounded-xl pl-9"
                autoFocus
              />
            </div>
          </section>

          <div className="grid min-h-0 min-w-0 gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
            <aside className="min-w-0 md:sticky md:top-6 md:self-start">
              <div className="flex w-full min-w-0 max-w-full gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-visible">
                <button
                  type="button"
                  className={cn(
                    "shrink-0 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                    category === null ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  onClick={() => updateSearchParam("category", null)}
                >
                  {t("help.all_categories")}
                  <span className="ml-2 text-xs opacity-70">{faqDocument.items.length}</span>
                </button>
                {faqDocument.categories.map((itemCategory) => (
                  <button
                    key={itemCategory}
                    type="button"
                    className={cn(
                      "shrink-0 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                      category === itemCategory ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                    onClick={() => updateSearchParam("category", itemCategory)}
                  >
                    {itemCategory}
                    <span className="ml-2 text-xs opacity-70">
                      {faqDocument.items.filter((item) => item.category === itemCategory).length}
                    </span>
                  </button>
                ))}
              </div>
            </aside>

            <section aria-live="polite" className="min-w-0">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{category ?? t("help.all_categories")}</h3>
                  <p className="text-xs text-muted-foreground">
                    {t("help.results", undefined, { count: filteredItems.length.toLocaleString() })}
                  </p>
                </div>
                {query ? (
                  <Button variant="ghost" size="sm" onClick={() => updateSearchParam("q", null)}>
                    {t("help.clear_search")}
                  </Button>
                ) : null}
              </div>

              {filteredItems.length > 0 ? (
                <Accordion
                  multiple
                  value={openItems}
                  onValueChange={handleOpenItemsChange}
                  className="overflow-hidden rounded-2xl bg-card shadow-sm"
                >
                  {filteredItems.map((item) => (
                    <AccordionItem key={item.id} id={item.id} value={item.id}>
                      <AccordionTrigger className="gap-4 px-4 py-4 hover:no-underline md:px-5">
                        <span className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 shrink-0 font-mono text-[11px] text-muted-foreground">{item.id}</span>
                          <span className="text-[14px] leading-6">{item.question}</span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="space-y-4 px-4 pb-5 md:px-5 md:pl-[78px]">
                        <AnswerText>{item.answer}</AnswerText>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{item.category}</Badge>
                          <span className="text-xs text-muted-foreground">{item.scope}</span>
                        </div>
                        {item.sources.length > 0 ? (
                          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                            <span className="text-xs text-muted-foreground">{t("help.sources")}</span>
                            {item.sources.map((source) => (
                              <Button
                                key={`${item.id}-${source.path}`}
                                variant="link"
                                size="xs"
                                className="h-auto px-0"
                                onClick={() => platform.openLink(docsUrl(source.path))}
                              >
                                {source.label}
                                <ArrowUpRight className="size-3" />
                              </Button>
                            ))}
                          </div>
                        ) : null}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              ) : (
                <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
                  <Search className="mx-auto size-6 text-muted-foreground" />
                  <h3 className="mt-3 text-sm font-medium">{t("help.no_results")}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t("help.no_results_hint")}</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
