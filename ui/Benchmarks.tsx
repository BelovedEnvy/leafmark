"use client";

import { useEffect, useState } from "react";
import BarChart from "@/components/charts/bar-chart";
import Bar from "@/components/charts/bar";
import BarXAxis from "@/components/charts/bar-x-axis";
import ChartTooltip from "@/components/charts/tooltip/chart-tooltip";
import { Gauge } from "@/components/charts/gauge";
import type { Answer } from "./Workspace";

const metrics = {
  hit_rate: "Hit Rate@5",
  mrr: "MRR@5",
  abstention_accuracy: "Abstention accuracy",
  faithfulness: "Faithfulness",
  quote_verification: "Exact-quote verification",
  avg_latency_ms: "Average latency",
};
type Metric = keyof typeof metrics;
type Row = { variant: string } & Record<Metric, number | null>;
const keys = Object.keys(metrics) as Metric[];

function format(key: Metric, value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (key === "avg_latency_ms") return `${Math.round(value).toLocaleString("en")} ms`;
  return key === "mrr" ? value.toFixed(3) : `${(100 * value).toFixed(1)}%`;
}

export default function Benchmarks({ answer }: { answer?: Answer }) {
  const [metric, setMetric] = useState<Metric>("hit_rate");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/benchmarks.json", { cache: "no-store", signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const result = await r.json();
        if (!Array.isArray(result.rows)) throw new Error();
        setRows(result.rows);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const score = answer?.groundedness_score;
  const data =
    rows
      ?.filter((r) => Number.isFinite(r[metric]))
      .map((r) => ({
        name: r.variant,
        [metrics[metric]]:
          metric === "mrr" || metric === "avg_latency_ms"
            ? r[metric]
            : Number((r[metric]! * 100).toFixed(1)),
      })) ?? [];
  return (
    <div className="benchmark-content">
      <section className="score-chart">
        <h3>Current answer groundedness</h3>
        {score == null ? (
          <p className="benchmark-copy">A score appears with a model-generated answer.</p>
        ) : (
          <>
            <p className="grounded-value">{format("faithfulness", score)}</p>
            <div aria-hidden="true">
              <Gauge
                value={score * 100}
                orientation="linear"
                totalNotches={40}
                linearHeight={17}
                useGradient={false}
                activeFill="var(--green)"
                inactiveFill="var(--line)"
              />
            </div>
          </>
        )}
      </section>
      <div className="benchmark-controls">
        <h3>Retrieval benchmark</h3>
        {!!rows?.length && (
          <select
            aria-label="Chart metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value as Metric)}
          >
            {keys.map((k) => (
              <option key={k} value={k}>
                {metrics[k]}
              </option>
            ))}
          </select>
        )}
      </div>
      {failed ? (
        <p role="alert" className="benchmark-copy">
          The benchmark report could not be loaded.
        </p>
      ) : rows === null ? (
        <p role="status">Loading results…</p>
      ) : rows.length === 0 ? (
        <p className="benchmark-copy">
          The four retrieval variants have no published run yet. Results appear here after the
          30-question evaluation completes.
        </p>
      ) : (
        <>
          {!!data.length && (
            <div className="benchmark-chart" aria-hidden="true">
              <BarChart
                data={data}
                xDataKey="name"
                aspectRatio="2.8 / 1"
                margin={{ top: 12, bottom: 32, left: 4, right: 4 }}
                animationDuration={200}
              >
                <Bar dataKey={metrics[metric]} fill="var(--green)" lineCap={3} showValue />
                <BarXAxis />
                <ChartTooltip />
              </BarChart>
            </div>
          )}
          <div className="metrics-table" tabIndex={0} role="region" aria-label="Benchmark results">
            <table>
              <caption className="sr-only">
                Measured retrieval and answer quality for each chunking variant
              </caption>
              <thead>
                <tr>
                  <th scope="col">Variant</th>
                  {keys.map((k) => (
                    <th key={k} scope="col">
                      {metrics[k]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.variant}>
                    <th scope="row">{r.variant}</th>
                    {keys.map((k) => (
                      <td key={k}>{format(k, r[k])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
