# Rainsi Performance Benchmark

## Overview

This document records the performance testing performed on **Rainsi**, a browser-oriented Lua runtime built around WebAssembly/WASI, and compares its performance with **Wasmoon 1.16.0**.

Rainsi was tested across five Lua versions:

* Lua 5.1.5
* Lua 5.2.4
* Lua 5.3.6
* Lua 5.4.7
* Lua 5.5.1

The benchmark suite includes both **synthetic interpreter workloads** and **larger real-world Lua workloads**.

The purpose of the testing was to determine how Rainsi performs across different Lua versions and how its performance compares with an established WebAssembly Lua runtime.

The benchmarks cover:

* Runtime startup
* Arithmetic
* Loop execution
* Table operations
* String operations
* Lua function calls
* JavaScript ↔ Lua callbacks
* Penlight
* LuaInspect
* LuaGB

The results show that Rainsi's performance is generally in the same range as Wasmoon on the tested workloads, while the real-world tests also expose compatibility differences between runtimes.

---

# Benchmark Environment

The benchmarks were performed using:

* **Node.js:** 22.16.0
* **npm:** 10.9.2
* **Wasmoon:** 1.16.0
* **Rainsi:** tested using Lua 5.1.5 through Lua 5.5.1

The Wasmoon benchmark used the published `wasmoon@1.16.0` package.

Rainsi executes actual Lua runtimes compiled to WebAssembly and provides the JavaScript/WASI compatibility layer required to run them in the JavaScript environment.

---

# Methodology

The benchmark suite contains two broad categories.

## Synthetic workloads

Synthetic tests isolate specific runtime operations:

* Arithmetic
* Loops
* Table writes
* String operations
* Lua function calls
* Runtime startup

These are useful for identifying differences in particular interpreter operations.

## Real-world workloads

Larger Lua programs were also tested to avoid relying exclusively on microbenchmarks.

The real-world workloads included:

* [Penlight](https://github.com/lunarmodules/Penlight)
* LuaInspect
* [LuaGB](https://github.com/zeta0134/LuaGB)

These workloads exercise substantially more Lua functionality than a simple arithmetic loop.

---

# Rainsi Lua Version Results

The following measurements were obtained from Rainsi's five supported Lua versions.

| Workload                | Lua 5.1.5 | Lua 5.2.4 | Lua 5.3.6 | Lua 5.4.7 | Lua 5.5.1 |
| ----------------------- | --------: | --------: | --------: | --------: | --------: |
| Startup                 |  17.26 ms |   7.35 ms |   6.20 ms |   7.39 ms |  14.02 ms |
| 1M arithmetic           |  10.39 ms |  10.74 ms |  12.00 ms |  12.26 ms |  13.05 ms |
| 5M loop                 |  36.20 ms |  39.90 ms |  38.64 ms |  44.82 ms |  35.21 ms |
| 100k table writes       |   3.33 ms |   4.13 ms |   3.25 ms |   2.94 ms |   2.53 ms |
| 10k string operations   |  11.07 ms |   8.03 ms |   4.19 ms |   7.07 ms |   8.19 ms |
| 500k Lua function calls |  19.09 ms |  18.36 ms |  20.51 ms |  14.58 ms |  16.34 ms |

These results demonstrate that the different Lua versions do not have identical performance characteristics.

For example, Lua 5.5.1 measured the lowest time in the 5-million-iteration loop test at **35.21 ms**, while Lua 5.4.7 measured **44.82 ms**.

Table writes showed a different pattern, with Lua 5.5.1 measuring **2.53 ms** and Lua 5.1.5 measuring **3.33 ms**.

String operations also varied considerably between versions, with Lua 5.3.6 measuring **4.19 ms** compared with **11.07 ms** for Lua 5.1.5.

These results are workload-specific and should not be interpreted as a general performance ranking of Lua versions.

---

# Wasmoon vs Rainsi

The primary direct comparison used **Wasmoon 1.16.0**, Rainsi Lua 5.4.7, and Rainsi Lua 5.5.1.

| Workload                  | Wasmoon 1.16.0 | Rainsi 5.4.7 | Rainsi 5.5.1 |
| ------------------------- | -------------: | -----------: | -----------: |
| Startup                   |        6.44 ms |      5.33 ms |      6.08 ms |
| 1M arithmetic             |        8.49 ms |      9.68 ms |      8.29 ms |
| 5M loop                   |       38.00 ms |     45.40 ms |     35.20 ms |
| 100k table writes         |        1.72 ms |      1.64 ms |      1.44 ms |
| 10k string concatenations |        6.11 ms |      6.17 ms |      8.80 ms |
| 500k Lua function calls   |       14.82 ms |     13.79 ms |     13.92 ms |

## Startup

Measured startup times were:

* Wasmoon: **6.44 ms**
* Rainsi 5.4.7: **5.33 ms**
* Rainsi 5.5.1: **6.08 ms**

The Rainsi measurements were therefore in the same general range as Wasmoon for this test.

## Arithmetic

For one million arithmetic operations:

* Wasmoon: **8.49 ms**
* Rainsi 5.4.7: **9.68 ms**
* Rainsi 5.5.1: **8.29 ms**

Rainsi 5.5.1 measured approximately **0.20 ms lower** than Wasmoon in this particular workload, while Rainsi 5.4.7 measured approximately **1.19 ms higher**.

The results therefore do not show a single consistent difference across the two Rainsi versions.

## Loop execution

For five million loop iterations:

* Wasmoon: **38.00 ms**
* Rainsi 5.4.7: **45.40 ms**
* Rainsi 5.5.1: **35.20 ms**

Rainsi 5.4.7 measured approximately **7.40 ms higher** than Wasmoon, while Rainsi 5.5.1 measured approximately **2.80 ms lower**.

This demonstrates that Lua-version selection can have a noticeable effect on a particular workload.

## Table writes

For 100,000 table writes:

* Wasmoon: **1.72 ms**
* Rainsi 5.4.7: **1.64 ms**
* Rainsi 5.5.1: **1.44 ms**

All three measurements were close, with Rainsi 5.5.1 having the lowest measured time in this workload.

## String concatenation

For 10,000 string concatenation operations:

* Wasmoon: **6.11 ms**
* Rainsi 5.4.7: **6.17 ms**
* Rainsi 5.5.1: **8.80 ms**

Rainsi 5.4.7 and Wasmoon were separated by only **0.06 ms** in this test.

Rainsi 5.5.1 measured higher at **8.80 ms**.

## Lua function calls

For 500,000 Lua function calls:

* Wasmoon: **14.82 ms**
* Rainsi 5.4.7: **13.79 ms**
* Rainsi 5.5.1: **13.92 ms**

Both tested Rainsi versions measured below Wasmoon for this particular workload.

The difference between Rainsi 5.4.7 and Wasmoon was approximately **1.03 ms**.

---

# JavaScript ↔ Lua Interoperability

A newer Rainsi build was also tested for JavaScript callback functionality.

A JavaScript function was registered with Lua:

```javascript
engine.register("jsadd", (a, b) => a + b);
```

Lua was then able to call the JavaScript function:

```lua
return jsadd(2, 3)
```

which returned:

```text
5
```

JavaScript could also call the registered function through the Rainsi API:

```javascript
engine.call("jsadd", 4, 5)
```

which returned:

```text
9
```

This verified bidirectional interaction between the JavaScript API and Lua execution environment.

---

## Callback Performance

The following callback measurements were recorded using Lua 5.4.7:

| Workload                               |     Time |
| -------------------------------------- | -------: |
| 10,000 JS callbacks returning a value  |  3.66 ms |
| 100,000 JS callbacks returning a value | 22.41 ms |
| 10,000 JS callbacks returning nothing  |  1.58 ms |

These are **interop measurements**, not pure Lua interpreter benchmarks.

The measured time includes the relevant JavaScript/Lua boundary and callback machinery.

For 100,000 callbacks returning a value, the measured time was **22.41 ms**, corresponding to roughly **0.224 µs per callback** under the benchmark conditions.

For 10,000 callbacks returning nothing, the measured time was **1.58 ms**, or roughly **0.158 µs per callback**.

These numbers should be understood as measurements of this particular callback implementation and workload rather than universal JavaScript/Lua interop costs.

---

# Penlight Benchmark

A larger real-world workload was constructed using **Penlight**, a substantial pure-Lua library.

The workload consisted of:

* 115 Lua files
* Approximately 683 KB of Lua source across the project
* Approximately 431 KB of actual bundled benchmark/test workload

The workload exercised:

* `pl.List`
* `pl.tablex`
* `pl.stringx`
* `pl.pretty`
* `pl.class`
* Table creation
* Table manipulation
* Sorting
* Nested copying
* Serialization
* Deserialization
* String processing
* Class/object creation
* Approximately 12,000 records
* Approximately 8,000 active records
* Approximately 2,000 class instances

## Results

| Runtime        |    Median |
| -------------- | --------: |
| Rainsi 5.1.5   |  94.70 ms |
| Rainsi 5.2.4   |  91.12 ms |
| Rainsi 5.3.6   | 103.41 ms |
| Rainsi 5.4.7   |  91.96 ms |
| Rainsi 5.5.1   | 105.85 ms |
| Wasmoon 1.16.0 |  91.19 ms |

The closest measurements were Rainsi 5.2.4 at **91.12 ms**, Wasmoon at **91.19 ms**, and Rainsi 5.4.7 at **91.96 ms**.

Rainsi 5.4.7 differed from Wasmoon by approximately **0.77 ms** in this workload.

This result is notable because the benchmark exercises many different parts of the Lua runtime rather than a single isolated operation.

The results also demonstrate variation between Lua versions. Rainsi 5.3.6 and 5.5.1 measured above 100 ms, while Rainsi 5.2.4 and 5.4.7 were around 92 ms.

---

# LuaInspect Benchmark

LuaInspect was used as another larger Lua workload.

The workload contained:

* 36 Lua files
* Approximately 339 KB of Lua source
* Lua parsing
* AST generation
* Tokenization
* Semantic inspection

The benchmark processed approximately 36 KB of `pl/xml.lua` source.

Rainsi Lua 5.1.5 successfully executed the workload and generated:

* An AST
* Approximately 4,400 tokens

The measured Rainsi 5.1.5 median was approximately:

```text
1,254 ms
```

## Wasmoon Compatibility

Wasmoon 1.16.0 did not execute the LuaInspect workload unchanged.

The workload uses older Lua 5.1 constructs and environment assumptions, including constructs such as:

```lua
module("lexer", package.seeall)
```

Because the workload was not successfully executed unchanged under Wasmoon, its LuaInspect result should **not** be treated as a direct performance comparison.

This benchmark therefore provides useful information about **runtime compatibility**, but not a valid Wasmoon-vs-Rainsi execution-time comparison.

---

# LuaGB Benchmark

LuaGB was used as a sustained, real-world Lua workload.

LuaGB is a pure-Lua Game Boy emulator.

The benchmark used the emulator core rather than its LÖVE graphical frontend.

## Workload

The benchmark contained:

* 31 Lua files in the core
* Approximately 161 KB of Lua source
* A deterministic 32 KiB Game Boy ROM
* A fresh emulator instance
* Exactly 1,000,000 `gb:step()` calls

The benchmark also calculated a deterministic final-state hash.

Expected result:

```text
steps = 1000000
PC = 221
clock = 4244140
hash = 952974115
```

---

## LuaGB Results

| Runtime        |  Median |
| -------------- | ------: |
| Rainsi 5.4.7   | ~864 ms |
| Wasmoon 1.16.0 | ~888 ms |

The individual observed measurements for Rainsi were approximately:

```text
1241 ms
858 ms
865 ms
854 ms
883 ms
```

The individual observed measurements for Wasmoon were approximately:

```text
1333 ms
1033 ms
888 ms
893 ms
872 ms
```

The final emulator state matched the expected deterministic result across the successful runs:

```text
PC     = 221
clock  = 4244140
hash   = 952974115
```

This makes LuaGB particularly useful as a benchmark because it combines:

* Long-running Lua execution
* Large numbers of function calls
* Tables and state manipulation
* Emulator logic
* Arithmetic
* Branching
* Memory/state updates

It therefore represents a substantially different workload from isolated arithmetic or loop benchmarks.

---

# Benchmark Comparison Summary

| Workload                  | Wasmoon 1.16.0 | Rainsi 5.4.7 | Rainsi 5.5.1 |
| ------------------------- | -------------: | -----------: | -----------: |
| Startup                   |        6.44 ms |      5.33 ms |      6.08 ms |
| 1M arithmetic             |        8.49 ms |      9.68 ms |      8.29 ms |
| 5M loop                   |       38.00 ms |     45.40 ms |     35.20 ms |
| 100k table writes         |        1.72 ms |      1.64 ms |      1.44 ms |
| 10k string concatenations |        6.11 ms |      6.17 ms |      8.80 ms |
| 500k Lua function calls   |       14.82 ms |     13.79 ms |     13.92 ms |
| Penlight                  |       91.19 ms |     91.96 ms |    105.85 ms |
| LuaGB                     |        ~888 ms |      ~864 ms | Not measured |

The measurements show that the relative performance depends substantially on the workload and Lua version.

Some workloads show extremely close measurements, while others show larger differences.

---

# What the Benchmarks Demonstrate

## 1. Rainsi is within the same general performance range as Wasmoon on the tested workloads

The synthetic benchmarks do not show a consistent large performance gap between Rainsi and Wasmoon.

Several measurements are very close, including:

* Startup
* Table writes
* String concatenation with Rainsi 5.4.7
* Lua function calls
* Penlight

For example, Penlight measured:

```text
Wasmoon:       91.19 ms
Rainsi 5.4.7:  91.96 ms
```

while LuaGB measured:

```text
Wasmoon:       ~888 ms
Rainsi 5.4.7:  ~864 ms
```

---

## 2. Lua version matters

Rainsi's performance is not identical across Lua versions.

The same benchmark can produce substantially different measurements depending on the Lua VM being used.

For example, the 5-million-loop benchmark measured:

```text
Lua 5.1.5: 36.20 ms
Lua 5.2.4: 39.90 ms
Lua 5.3.6: 38.64 ms
Lua 5.4.7: 44.82 ms
Lua 5.5.1: 35.21 ms
```

Therefore, "Rainsi performance" cannot be represented by a single number without specifying the Lua version.

---

## 3. Real-world workloads provide a different picture from microbenchmarks

The Penlight and LuaGB benchmarks demonstrate that small synthetic differences do not necessarily translate directly into large differences in larger programs.

Penlight produced very similar measurements for Rainsi 5.2.4, Rainsi 5.4.7, and Wasmoon.

LuaGB also produced measurements in a relatively close range between Rainsi 5.4.7 and Wasmoon.

---

## 4. Compatibility is separate from performance

LuaInspect demonstrates why compatibility needs to be reported separately.

Rainsi successfully executed the tested LuaInspect workload, while Wasmoon did not execute the workload unchanged because of Lua 5.1 compatibility/environment assumptions.

This cannot be reduced to a simple performance number.

---

# Limitations

These benchmarks represent specific workloads rather than all possible Lua programs.

Performance can vary depending on:

* CPU
* Operating system
* Node.js version
* JavaScript engine
* WebAssembly implementation
* Runtime initialization state
* Workload characteristics
* Lua version

Small differences should not automatically be interpreted as statistically meaningful without the full distribution of benchmark runs.

The JS callback measurements specifically include JavaScript/Lua boundary overhead and therefore should not be interpreted as measurements of Lua VM execution alone.

Similarly, the LuaGB and Penlight workloads represent real applications, but they are still only two particular application workloads.

The LuaInspect comparison is primarily a compatibility observation because both runtimes did not execute the same workload unchanged.

---

# Conclusion

The completed benchmark suite shows that **Rainsi and Wasmoon 1.16.0 operate in broadly similar performance ranges across the tested workloads**, with the exact result depending on the Lua version and workload.

Rainsi's five tested Lua versions also show meaningful differences between one another. No single Lua version produced the lowest measurement across every workload.

The synthetic tests provide isolated measurements for interpreter operations such as arithmetic, loops, tables, strings, and function calls. The Penlight and LuaGB tests provide larger workloads that exercise combinations of these operations.

The Penlight benchmark produced particularly close results between Rainsi 5.4.7 and Wasmoon:

```text
Rainsi 5.4.7: 91.96 ms
Wasmoon:      91.19 ms
```

The LuaGB benchmark also produced relatively close sustained-execution measurements:

```text
Rainsi 5.4.7: ~864 ms
Wasmoon:      ~888 ms
```

while maintaining the same deterministic emulator result.

The callback tests additionally demonstrate that the Rainsi API can perform JavaScript ↔ Lua interaction at measurable sub-millisecond-per-thousand-call scales under the tested conditions.

Overall, the benchmark data establishes a performance profile for Rainsi across **five Lua versions, synthetic interpreter workloads, JavaScript interop, and larger real-world Lua programs**, while also documenting compatibility differences where an equivalent execution could not be performed.
