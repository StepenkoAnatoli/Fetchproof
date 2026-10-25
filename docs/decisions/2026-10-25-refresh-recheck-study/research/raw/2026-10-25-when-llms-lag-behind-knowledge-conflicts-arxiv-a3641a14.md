---
url: https://arxiv.org/html/2604.09515
retrieved: 2026-10-25
command: http-keyless scrape https://arxiv.org/html/2604.09515
statusCode: 200
transport: http-keyless
completeness: partial
omitted: 4 sibling section(s) totalling ~189 words were outside the page's main content and are not in this capture
title: When LLMs Lag Behind: Knowledge Conflicts from Evolving APIs in Code Generation
---
# When LLMs Lag Behind: Knowledge Conflicts from Evolving APIs in Code Generation

 Conference:  ; ;


 Ahmed Nusayer Ashik

 Affiliation:  University of Manitoba , Winnipeg , Canada

 email: [ashikan@myumanitoba.ca](mailto:ashikan@myumanitoba.ca)

 ,
 Shaowei Wang

 Affiliation:  University of Manitoba , Winnipeg , Canada

 email: [shaowei.wang@umanitoba.ca](mailto:shaowei.wang@umanitoba.ca)

 ,
 Tse-Hsun Chen

 Affiliation:  Concordia University , Montreal , Canada

 email: [peterc@encs.concordia.ca](mailto:peterc@encs.concordia.ca)

 ,
 Muhammad Asaduzzaman

 Affiliation:  University of Windsor , Windsor , Canada

 email: [masaduzz@uwindsor.ca](mailto:masaduzz@uwindsor.ca)

 and
 Yuan Tian

 Affiliation:  Queen’s University , Kingston , Canada

 email: [y.tian@queensu.ca](mailto:y.tian@queensu.ca)


 © acmlicensed



###### Abstract.


 The rapid evolution of software libraries creates a significant challenge for Large Language Models (LLMs), whose static parametric knowledge often becomes stale post-training. While retrieval-augmented generation (RAG) is commonly used to provide up-to-date API specifications, “context-memory conflict” arises when external instructions contradict a model’s internal parametric knowledge. This paper presents a systematic empirical study of LLM code generation under API evolution (e.g., API deprecation, API modification, and API addition), by constructing a benchmark of 270 real-world updates from eight Python libraries. We evaluate four LLM families of 11 models. Our results show that without comprehensive documentation, LLMs struggle to prioritize external context, averaging only 42.55% of generated code examples are executable in the target environment. While structured documentation and larger model scales improve LLMs’ ability to update adoption, they do not fully resolve executability issues with a low 66.36% executable rate. In addition, reasoning-based strategies (e.g., Self-Reflection) significantly boost LLMs’ performance with 11% improvement on executable rate. Our findings highlight the persistence of outdated patterns from LLMs, even when API update specifications are provided, and emphasize the need for evolution-aware benchmarks and techniques.





## 1. Introduction


 Software libraries are the backbone of modern software development. Developers routinely rely on well-established libraries to build complex, production-grade systems. Yet these libraries are far from static. Libraries evolve continuously (e.g., outdated Application Programming Interfaces (API) are deprecated or removed) to reflect improved design principles or performance requirements  ([Xavier et al., 2017](#bib.bib48); [Lamothe et al., 2021](#bib.bib22)) . This continuous evolution creates a significant maintenance burden: developers must track changes, learn new idioms, and update their existing code base accordingly to avoid breaks.


 Large language models (LLMs) have recently emerged as powerful coding assistants, demonstrating impressive ability to generate syntactically correct, contextually relevant code across a wide range of tasks, and are used to accelerate software development   ([Peng et al., 2023](#bib.bib36); [Ziegler et al., 2024](#bib.bib57)) . However, LLMs are fundamentally trained on static corpora with a fixed knowledge cutoff. The parametric knowledge encoded in their weights reflects the state of the world, and the state of library APIs as of their training data. When an API evolves after this cutoff, the model’s internal knowledge becomes stale, and it may confidently generate code using outdated methods that no longer compile or produce correct behavior  ([Wu et al., 2024b](#bib.bib46); [Wang et al., 2025a](#bib.bib41)) .


 A natural and widely adopted mitigation is retrieval-augmented generation (RAG) and prompt-based context injection  ([Lewis et al., 2020](#bib.bib23); [He et al., 2025](#bib.bib15); [Liang et al., 2025](#bib.bib27)) . In software development contexts, this translates to developers supplying the LLM with up-to-date API specification (e.g., update description and updated API documentation) directly in the prompt, expecting the model to follow this external context and override its stale parametric knowledge. Yet this solution is deceptively fragile. LLMs are known to exhibit a fundamental tension between parametric knowledge (what they learned during training and store in parameters) and contextual knowledge (what is supplied at inference time)  ([Xie et al., 2023](#bib.bib49); [Xu et al., 2024](#bib.bib50)) . When provided context disagrees with a model’s internal beliefs, context-memory conflict emerges. Recent research shows that models are often unable to fully suppress their internal knowledge even when explicitly instructed to do so, with performance consistently higher when contextual and parametric knowledge are aligned  ([Sun et al., 2025](#bib.bib40); [Cheng et al., 2024](#bib.bib6)) . API evolution creates exactly such a conflict (i.e., old APIs in parametric knowledge vs. externally provided updated specification), it is deeply unclear how reliably models will defer to the provided context rather than fall back on memorized, outdated patterns.


 To address this gap, we present the first systematic empirical study of LLM code generation under API evolution. We constructed a benchmark spanning real-world API updates across eight popular Python libraries and contains 270 updated API across three updated patterns (i.e., 45 deprecated/removed APIs, 128 modified APIs, and 97 newly introduced APIs). Those updated APIs are collected after the model knowledge cut-off date to ensure they do not exist in the model’s parametric knowledge. We conducted our study on four LLM families (i.e., DeekSeek-Coder, CodeLlama, DeepSeek-R1-Qwen, and GPT-4o-mini) with varied sizes. Using the benchmark, we prompt LLMs to generate code examples that demonstrate correct usage of each updated API. To evaluate LLM performance, we design two complementary metrics. First, to measure whether the model acknowledges and responds to the externally provided update at the coarse level, we propose API Adoption Rate that measures whether the generated code at least partially adopt API update specification provided in the external context (e.g., invoking the recommended alternative in deprecated/removed APIs, even if not correctly), rather than ignoring them entirely. Executable Rate , computed exclusively over code examples that pass the first adoption filter, measures whether the generated code successfully runs in the target library environment, serving as the indicator of full and correct API usage.




- •

 RQ1: To what extent can LLMs follow externally provided API update specifications to generate correct and executable code? Results: Without full API documentation, LLMs fail to follow externally provided update specifications reliably — only 74.64% adoption rate and 42.55% executable rate on average. Adding structured API documentation yields significant improvement, yet executable rate remains low (66.36%), and certain models (e.g., DeekSeek-R1) are even below 50%.

- •

 RQ2: How does performance vary across different model families and parameter scales?
 Results: Different model families present varied behavior patterns. Scaling parameter size improves adoption but does not consistently resolve executability weaknesses.

- •

 RQ3: Can reasoning-based prompting techniques help LLMs follow the external context correctly?
 Results: Reasoning-based prompting (i.e., Chain-of-Thought (CoT) and Self-Reflection (SR)) yields marginal gain in adoption rate but substantial executability improvements (+11.33% executable rate), with SR contributing more than CoT, particularly for API modification and addition patterns.

- •

 RQ4: What errors arise when LLMs fail to follow external API update specifications?
 Results: LLM failures fall into two levels. At the adoption level, omission (42.1%), old API usage (16.4%), and hallucinated APIs dominate. At the execution level, over half of failures stem from incorrect API usage, such as incorrect parameters (26.6%) and hallucinated behavior (16%).


 Our findings reveal certain implications, e.g., although providing API documentation can significantly improve the LLM’s performance, certain models still struggle with a low executable rate. Reasoning-based prompt techniques, such as Self-Reflection, should be used to improve performance. The community needs continuously evolving benchmarks that track API changes beyond model training cutoffs to evaluate LLMs, explicitly accounting for post-training knowledge gaps and techniques to resolve them.


 We make the following contributions:



- •

 We curate a benchmark of real-world API evolution across eight Python libraries, covering 270 updated APIs across three common patterns to evaluate the performance of LLMs on post-training knowledge that is not in their parametric knowledge.

- •

 We conduct a systematic study on four LLM families (11 models) to measure their ability to generate code that follows externally provided API updates for code generation.

- •

 We investigate two reasoning-oriented prompting strategies and show that they can improve LLM performance.



## 2. Related Work



### 2.1. LLM-based code generation


 Many LLMs are developed specifically for coding-related tasks and are often referred to as code language models  ([Jiang et al., 2026](#bib.bib18)) , such as StarCoder  ([Li et al., 2023](#bib.bib25)) , CodeLlama  ([Roziere et al., 2023](#bib.bib37)) , Qwen2.5-Coder  ([Hui et al., 2024](#bib.bib17)) , Deepseek-Coder  ([Guo et al., 2024b](#bib.bib14)) , and CodeGeeX  ([Zheng et al., 2023b](#bib.bib56)) . These models are trained on massive code corpora collected from software repositories, enabling strong performance across a wide range of programming tasks.
With the rapid development of coding-oriented LLMs, a variety of approaches have been proposed, ranging from function-level synthesis  ([Gu et al., 2025](#bib.bib11); [Khojah et al., 2025](#bib.bib20); [Wu et al., 2024a](#bib.bib47); [Zan et al., 2024](#bib.bib52)) to repository-level code generation  ([Zhang et al., 2024](#bib.bib53); [Li et al., 2025](#bib.bib24); [Gao et al., 2025](#bib.bib10); [Yang et al., 2025](#bib.bib51); [Wang et al., 2024](#bib.bib44)) . For example, Zan et al. proposed DiffCoder, which improves function-level code generation involving API usage by modeling the differences (diffs) between related coding tasks, mimicking human analogical learning  ([Zan et al., 2024](#bib.bib52)) . At the repository level, Zhang et al. introduced CODEAGENT, an LLM-based agent framework that integrates external tools to support complex, multi-file code generation tasks  ([Fu et al., 2023](#bib.bib9)) .
To systematically evaluate these models and approaches, a range of benchmark datasets have been developed  ([Chen et al., 2024](#bib.bib5)) . Representative function-level benchmarks include HumanEval  ([Li et al., 2022](#bib.bib26)) , HumanEval+  ([Liu et al., 2023a](#bib.bib29)) , MBPP  ([Austin et al., 2021](#bib.bib3)) , EvalPlus  ([Liu et al., 2023b](#bib.bib30)) , and APPS  ([Hendrycks et al., [n. d.]](#bib.bib16)) . For repository-level evaluation, commonly used benchmarks include SWE-bench  ([Jimenez et al., 2023](#bib.bib19)) , RepoBench  ([Liu et al., 2023c](#bib.bib32)) , CrossCodeEval  ([Ding et al., 2023](#bib.bib8)) , and RepoFuse  ([Liang et al., 2024](#bib.bib28)) .


 Despite these advances, existing studies either draw knowledge from models’ parametric knowledge or predominantly assume that the knowledge required for code generation is consistent with the model’s parametric knowledge acquired during pre-training. In contrast, our work investigates an underexplored setting where external knowledge conflicts with the model’s internal knowledge. By systematically analyzing how LLMs prioritize and reconcile these conflicting sources, we reveal critical limitations in leveraging post-training knowledge and provide insights for improving model reliability in dynamically evolving software ecosystems.



### 2.2. LLMs for Evolving APIs


 LLMs are typically trained on static, historical corpora, which inherently limits their ability to adapt to the evolutionary nature of software ecosystems. This temporal misalignment often leads to the generation of outdated or incorrect code. Prior studies have confirmed that deprecated API calls remain prevalent in LLM outputs; for instance, [Wang et al. (2025a)](#bib.bib41) observed a 25%-38% deprecated API usage rate across eight Python libraries, attributing this failure to both stale parametric knowledge and the absence of real-time API status during inference.


 Beyond simple deprecation, LLMs struggle with the nuances of version-specific evolution. Benchmarks such as GitChameleon 2.0 ([Misra et al., 2025](#bib.bib34)) reveal that even state-of-the-art models achieve only 48%-51% success in version-conditioned generation. Similarly, VersiCode ([Wu et al., 2024b](#bib.bib46)) and LibEvolutionEval ([Kuhar et al., 2025](#bib.bib21)) demonstrate that models frequently fail to adhere to version-specific instructions, showing significant performance volatility as APIs evolve. While Retrieval-Augmented Generation (RAG) is the standard mitigation—improving success rates by up to 13.5% on unseen Rust APIs ([Liang et al., 2025](#bib.bib27)) , providing the correct documentation does not guarantee the model will follow it.
Although providing the updated API specification is a natural way to mitigate the issue, it is unclear if LLMs really follow the externally provided information, and to what extent it follows, typically when the internal knowledge and externally provided knowledge are in conflict. Our study fills this gap. In addition, we provide the first systematic evaluation of how reasoning-based techniques, such as Self-Reflection and Chain-of-Thought, serve as mechanisms to resolve these internal knowledge conflicts.



## 3. Methodology


 Figure 1 . The overall workflow of our study.


 Figure [1](#S3.F1) presents the overall workflow of our study, which consists of three main phases: (1) constructing a dataset of updated APIs and their associated metadata, (2) prompting the studied LLMs to generate code examples demonstrating the usage of these updated APIs, and (3) evaluating the quality of the generated code examples. We describe each phase in detail below.



### 3.1. Dataset Construction


 To rigorously assess whether LLMs can correctly leverage updated API knowledge provided in the external context, we construct a benchmark dataset of API changes introduced after the knowledge cutoff of the target LLMs. Our construction process proceeds in the following steps.



#### 3.1.1. Library and Version Selection


 To ensure LLMs know the APIs, we target eight popular and widely used Python libraries: NumPy, Pandas, scikit-learn, SciPy, JAX, Keras, TensorFlow, and PyTorch. These libraries are widely adopted in data processing, machine learning, and deep learning, and have been commonly used in prior studies on API evolution  ([Wang et al., 2025b](#bib.bib42); [Wang et al., 2020](#bib.bib43)) . Since our goal is to evaluate LLMs’ ability to follow externally provided API knowledge rather than recall memorized patterns, we restrict our dataset to API changes introduced in versions released after December 2023, beyond the knowledge cutoff of most widely used LLMs  ([Guo et al., 2024b](#bib.bib14); [OpenAI, 2024](#bib.bib35); [Roziere et al., 2023](#bib.bib37); [Guo et al., 2025](#bib.bib12)) . This ensures that the API changes in our dataset are unlikely to be encoded in the models’ parametric knowledge, isolating the effect of external context provision. For each library, we identify all versions released after this cutoff date and collect their associated release notes from the corresponding GitHub repositories.



#### 3.1.2. API Update Pattern Identification


 Release notes serve as the primary source for identifying API changes, as they systematically summarize all modifications introduced in a given version, including bug fixes, behavioral changes, and API updates. In this study, we focus on three common API update patterns  ([Zhang et al., 2020](#bib.bib54)) :



- •

 P1 - API Deprecation : APIs that are removed or deprecated, typically with a recommended alternative one. Note that in this study, we only focus on the deprecated APIs that have alternative ones suggested, since our goal is to generate code examples to adopt the updates.

- •

 P2 - API Modification : APIs whose function name, parameters, or return type have been changed.

- •

 P3 - API Addition : Newly introduced APIs that did not exist in prior versions.


 Manually extracting and classifying API changes from release notes at scale is labor-intensive and error-prone. To address this, we leverage an LLM to automate the extraction process, taking advantage of its strong capabilities in natural language understanding and structured information extraction from software documentation  ([Bhattacharyya et al., 2025](#bib.bib4); [Daneshyan et al., 2025](#bib.bib7)) . Specifically, we prompt the LLM to parse each release note, identify API changes, and classify them into one of the three update patterns. For each extracted API change, we record: (1) the library name, (2) the version introducing the change, (3) the updated function name, and (4) a textual description of the update. We use GPT-5 mini  ([Singh et al., 2025](#bib.bib39)) for this extraction step, given its strong instruction-following ability and cost efficiency at scale.



#### 3.1.3. API Specification Extraction


 For each identified API change, we further collect the corresponding API documentation from the library’s official documentation pages. Specifically, we extract function signatures, parameter descriptions, return type information, code usage examples, and any additional notes available in the documentation. This documentation serves as the external context that will be provided to LLMs during code generation.
Entries for which no official documentation could be located are removed from the dataset to ensure the completeness and quality of the context provided to models. For P1 (API Deprecation) instances, our evaluation focuses on whether LLMs can generate correct code using the *alternative* API recommended to replace the deprecated or removed one, since the goal is to assess whether models can migrate away from stale API usage given external guidance. Accordingly, we also collect documentation for each recommended alternative API and discard P1 instances where alternative API documentation is unavailable. Similarly, we use LLM to extract API specification information from API documentation.



#### 3.1.4. Manual curation


 To ensure dataset quality, two authors independently inspected all collected API change instances and removed entries that did not meet our quality criteria. Specifically, we discarded instances where: (1) the extracted API change was incorrectly classified or did not correspond to a genuine API update (e.g., false positives introduced by the LLM-based extraction); (2) the API documentation was incomplete, ambiguous, or missing critical information such as function signatures or parameter descriptions. Any disagreements between the two authors during inspection were resolved through discussion until consensus was reached. This manual curation step ensures that every instance in our final dataset provides a well-defined, complete, and unambiguous specification that can serve as a reliable external context for LLM code generation.



#### 3.1.5. Resulting Dataset


 The dataset has 270 data instances across 3 patterns. The details of each pattern are presented in Table [1](#S3.T1).


 Table 1 . Data statistics for the three API update patterns, i.e., P1 - API Deprecation, P2- API Modification, and P3-API Addition



| Library Name | Versions | P1 | P2 | P3 |

| Numpy | 2.0.0 – 2.2.0 | 17 | 9 | 18 |

| Pandas | 2.2.0 – 2.2.1 | 3 | 10 | 2 |

| Scipy | 1.12.0 – 1.15.0 | 19 | 49 | 50 |

| Scikit Learn | 1.4 – 1.6 | 1 | 30 | 4 |

| Matplotlib | 3.9.0 – 3.10.0 | – | 13 | 7 |

| Keras | 3.10.0 | – | 12 | – |

| Jax | 0.4.28 – 0.4.29 | 4 | 5 | 16 |

| 0.4.31 – 0.4.32 | | | |

| 0.4.34 – 0.4.36 | | | |

| 0.4.38 | | | |

| 0.5.0 – 0.5.1 | | | |

| | 0.6.0 – 0.6.2 | | | |

| Pytorch | 2.7.0 | 1 | – | – |

| Total | | 45 | 128 | 97 |







### 3.2. Code Generation


 To simulate a realistic developer workflow, we design a code generation task for each API instance in our benchmark. Specifically, we prompt each LLM to generate a self-contained code example that correctly demonstrates the usage of the target updated API. Each prompt supplies two forms of external context: (1) an update description (UD) summarizing the nature of the API change (e.g., The function scipy.histogram is deprecated and removed from SciPy’s main namespace. Use numpy.histogram directly. ), and (2) the full API documentation (Doc) for the updated API, including its signature, parameters, and usage notes. Together, these mirror the information a developer would consult when migrating to or adopting an updated API.
The task is intentionally designed to create a conflict between external context and parametric knowledge: the correct implementation requires the model to follow the updated API specification provided in the prompt, which may directly contradict the outdated API patterns encoded in the model’s weights.


 Prior work has shown that clearly structured external context can strongly influence LLM responses even when it conflicts with parametric knowledge  ([Xie et al., 2023](#bib.bib49)) ; our task design allows us to directly measure the extent to which this holds for API-level code generation.
The prompt structure varies slightly by update pattern. For P2 (API Modification) , the model is asked to generate code using the modified API as specified in the provided documentation. For P1 (API Deprecation) , the model is prompted to generate code using the recommended alternative API described in the update. For P3 (API Addition) , the model is asked to generate code demonstrating the usage of the newly introduced API. Figure [2](#S3.F2) illustrates the prompt template for P2; templates for P1 and P3 follow the same structure with pattern-appropriate instructions.


 To isolate the contribution of the API documentation to model performance, we additionally construct a reduced-context condition in which the model receives only the update description (UD) without the full API documentation. Comparing performance between the full-context condition (UD + Doc) and the reduced-context condition (UD only) allows us to quantify how much the structured API documentation contributes to correct code generation.


 Figure 2 . Base prompt for code generation



#### 3.2.1. Reasoning-based prompting techniques


 Beyond standard prompting, we investigate whether reasoning-based prompting techniques can help LLMs better follow externally provided API context and reduce their reliance on outdated parametric knowledge. Prior work has shown that reasoning-oriented prompting encourages more deliberate, structured analysis before producing a final output  ([Liu et al., 2023d](#bib.bib31); [Sahoo et al., 2024](#bib.bib38)) , which may help models more faithfully interpret and apply updated API specifications. We evaluate two widely adopted techniques that represent complementary reasoning strategies: one that augments the generation process with explicit intermediate reasoning, and one that introduces a post-generation verification and correction step.


 Chain-of-Thought (CoT)   ([Wei et al., 2022](#bib.bib45)) prompts the model to explicitly reason through the problem before producing the final code. Rather than generating code directly, the model is first asked to analyze the provided update description and API documentation before the implementation. This explicit reasoning step is intended to direct the model’s attention toward the external context and surface potential conflicts with its parametric knowledge before they manifest as errors in the generated code.


 Self-Reflection (SR)   ([Madaan et al., 2023](#bib.bib33)) introduces a two-stage generation process in which the model first produces an initial code example and then critically reviews its own output. In the reflection stage, the model is explicitly asked to examine whether the generated implementation correctly follows the provided API documentation and update description, identify any inconsistencies — particularly cases where outdated API patterns may have been used — and revise the code accordingly. Unlike CoT, which intervenes before generation, SR operates after an initial attempt, making it complementary as a post-hoc correction mechanism. We append the self-reflection instruction as presented below.





### 3.3. Evaluation


 We evaluate the quality of the generated code along two complementary metrics.


 API Adoption Rate , measures whether the generated code shows any attempt to adopt the updated API specification provided in the external context: that is, whether the model at least partially incorporates the API changes described in the prompt rather than completely ignoring them. For P1 (API Deprecation), this means the generated code makes at least some use of the recommended alternative API, even if it is not used correctly (i.e., wrong parameters), rather than continuing to invoke the removed/deprecated one or use other irrelevant APIs. For P2 (API Modification), where the changes are typically minimal, often involving only a single updated parameter, this means the generated code reflects at least some aspect of the modification, such as using the revised parameter structure, even if the parameter positioning or data type is not entirely correct. For P3 (API Addition), similar to P1, this means the generated code attempts to use the newly introduced API, even though it is not complete. This metric aims to measure how prevalent the model completely omits the provided external context. API Adoption Rate serves as a coarse but critical first filter, establishing the baseline of whether the model at least acknowledges and responds to the externally provided API update.




| | A ​ P ​ I ​ A ​ d ​ o ​ p ​ t ​ i ​ o ​ n ​ R ​ a ​ t ​ e = #Partially or fully adopted code examples # Total code examples APIAdoptionRate=\frac{\text{\#Partially or fully adopted code examples}}{\text{\# Total code examples}} | |


 To scale evaluation across our full benchmark, we adopt an LLM-as-a-Judge approach  ([Zheng et al., 2023a](#bib.bib55)) , in which a judge model automatically determines whether each generated code example correctly follows the updated API specification provided in the prompt. The judge receives the update description, the API documentation, and the generated code as input, and is queried to produce a binary output (i.e., at least partially adopt or not). We use GPT5-mini as the judge model. To validate the reliability of this automated evaluation, two authors manually annotated a randomly sampled set of 1,000 generated code examples and compared these annotations against the LLM judge’s decisions. The judge achieved a labeling accuracy of 91.4% against the manual annotations, confirming that the automated evaluation is sufficiently reliable for large-scale analysis.


 Executable Rate.
Since static inspection in API Adoption Rate alone is insufficient to determine whether an API update has been completely and correctly adopted, we execute each generated code example in the target environment and use successful execution as the indicator of full correctness. This metric is computed exclusively over the subset of generated code examples that have already been identified as at least partially adopting the updated API, i.e., those that passed the API Adoption Rate filter. This restriction is intentional, since including code examples that show no adoption of the update would introduce bias, as such examples may still execute successfully by using entirely different, unrelated APIs that happen to be valid in the target environment.


 Code examples are extracted from model responses using regular expressions. Each example is then executed in an isolated virtual environment configured with the exact library version in which the corresponding API change was introduced, as recorded in our benchmark. Using the precise target version ensures that the execution environment faithfully reflects the state of the library at the point of the API change. Each virtual environment contains only the required library and its dependencies, preventing interference from other installed packages and eliminating version contamination that could otherwise introduce false positives or false negatives in the execution results.The Executable Rate is computed as:





| | E ​ x ​ e ​ c ​ u ​ t ​ a ​ b ​ l ​ e ​ R ​ a ​ t ​ e = #Executable code examples #Partially or fully adopted code examples ExecutableRate=\frac{\text{\#Executable code examples}}{\text{\#Partially or fully adopted code examples}} | |



## 4. Experimental Setting



### 4.1. Research Questions




- •

 RQ1: To what extent can LLMs follow externally provided API update specifications to generate correct and executable code?

- •

 RQ2: How does performance vary across different model families and parameter scales?

- •

 RQ3: Can reasoning-based prompting techniques help LLMs to follow the external context correctly?

- •

 RQ4: What errors arise when LLMs fail to follow external API update specifications?



### 4.2. Evaluated LLMs


 To evaluate how different LLMs handle evolved APIs that are not stored in their parametric knowledge, we select models from multiple model families and parameter scales. Our selection is guided by four criteria: 1) The models must have a knowledge cutoff prior to December 2023, ensuring that the API updates collected in our benchmark (introduced after December 2023) are unlikely to be included in their training data. This requirement enables us to reliably construct scenarios where the models possess outdated parametric knowledge of the APIs. 2) We select models that provide multiple parameter scales within the same model family. This allows us to investigate how knowledge conflict behavior varies with model size. 3) We include both open-source and proprietary models to ensure the generalizability of our findings across different model ecosystems. 4) We include both reasoning and non-reasoning models.


 Following these criteria, we select four representative model series and Table [2](#S4.T2) summarizes the selected models, their parameter sizes, knowledge cutoff dates, and open-source availability.


 Table 2 . Summary of evaluated LLMs.



| Model Series | Size Variants | Cutoff Date | Open Source |

| DeepSeek-Coder  ([Guo et al., 2024a](#bib.bib13)) | 1.3B, 6.7B, 33B | Before Nov 2023 | ✓ |

| CodeLlama  ([Roziere et al., 2023](#bib.bib37)) | 7B, 13B, 34B | No official date

 (Released on Aug 2023) | ✓ |

| DeepSeek-R1-Qwen  ([Guo et al., 2025](#bib.bib12)) | 1.5B, 7B, 14B, 32B | Late 2023 | ✓ |

| GPT-4o mini  ([OpenAI, 2024](#bib.bib35)) | N/A | Oct 2023 | ✗ |







### 4.3. Approaches of RQs


 To answer RQ1 and RQ2, we conduct controlled experiments using the code generation task described in Section [3.2](#S3.SS2) across all API instances in our benchmark and all selected LLMs. For each API instance, we prompt the LLM to generate a code example using the update description and the corresponding API documentation. We collect the generated code examples and measure the Accuracy for each pattern across all studied LLMs.


 To answer RQ3, we compare the baseline (UD+Doc) where only the update description and API documentation are provided, with the prompts with CoT and SR (i.e., UD+Doc+CoT and UD+Doc+CoT+SR). All prompts contain the same external context, including the API update description and the corresponding documentation. The only difference between configurations is the presence of reasoning instructions. For each configuration, we generate code for all API instances using the evaluated LLMs and measure their accuracy and executable rate.


 To answer RQ4, we analyzed the failure cases from all models that still exist under the best configuration (UD+Doc+CoT+SR) in our study (see results in Section [5.3](#S5.SS3)). Specifically, we analyzed two levels of failures. L1: all cases where the LLM failed to adopt the API update specification at all (195 cases in total); and L2: all cases where the update was at least partially adopted but the generated code failed to execute (781 cases in total). For L1, we first run a pilot study on randomly sampled failure cases to derive the following failure categories:



- •

 Hallucination: Generated code that is not relevant to the updates
described in the update description.

- •

 Omission: Completely ignored requirements specified in the update (e.g., API/Alternate API in P1 and P3, and updated parameters in P2).

- •

 Old API Usage: Used only the deprecated or removed API that the update is meant to replace. The new/alternate API does not appear in the code.

- •

 Mixed API Usage: Used both old and new API patterns in the same snippet.

- •

 Others: Does not fit any of the above.


 To scale up our failure analysis to all failure cases, we used GPT-5 mini as a code review judge to classify the failure cases in to above derived categories. We provided the judge LLM with the API update description, the LLM-generated code in response to that update, and the definition of the failure categories, and asked it to identify in which category the failure falls.


 For L2, following a similar process as 1), we first derive the following failure categories and then apply LLM-as-a-judge to classify the failure category for each case.



- •

 Hallucinated Behavior : Used the API update but it behaves in a way that contradicts its actual specification (e.g., assumed a return type, chained a method that does not exist on the result).

- •

 Wrong Parameters: Used the API update but with incorrect arguments, wrong parameter names, wrong types, or wrong argument order.

- •

 Incompatible Context: Used the updated API with correct syntax but in
a context where it cannot work (e.g., initialization of the data is wrong).

- •

 Missing Setup : Adopted the API update correctly in isolation but missed required setup steps such as imports and configuration of the environment.

- •

 Not Update Related: The error is unrelated to the API usage (e.g., a typo and an unrelated syntax error to the updated API).


 To ensure the reliability of our annotation, we manually labeled 50 failure cases (20 cases from L1, and 30 cases from L2. Accuracy is 90% (45/50).



### 4.4. Implementation Details


 All experiments are done in Python 3.10. We used 8 bit quantized model for Deepseek-coder-33B, CodeLlama-34B, and Deepseek-r1-qwen-33B. All the experiments were conducted on a server with four RTX 3090 GPUs and 256G RAM.



## 5. Results



### 5.1. RQ1 - API update specification compliance



 Table 3 . The API adoption rate across different API update patterns and prompting strategies. A larger value is preferable and is marked in a darker color.



| | P1 – API Deprecation | P2 – API Modification | P3 – API Addition |

| LLM | UD | UD+Doc | +CoT | +CoT/SR | UD | UD+Doc | +CoT | +CoT/SR | UD | UD+Doc | +CoT | +CoT/SR |

| Deepseek-coder-1.3B-instruct | 75.56% | 97.78% | 97.78% | 100% | 47.66% | 71.87% | 64.06% | 69.53% | 94.85% | 98.97% | 100% | 98.97% |

| Deepseek-coder-6.7B-instruct | 66.67% | 100% | 97.78% | 100% | 64.06% | 82.03% | 85.94% | 86.72% | 73.2% | 90.72% | 96.91% | 95.88% |

| Deepseek-coder-33B-instruct | 73.33% | 97.78% | 100% | 100% | 82.03% | 90.62% | 92.97% | 94.53% | 68.04% | 95.88% | 98.97% | 98.97% |

| CodeLlama-7B-Instruct | 20.00% | 86.67% | 100% | 97.78% | 72.66% | 89.06% | 92.97% | 89.06% | 97.94% | 100% | 100% | 100% |

| CodeLlama-13B-Instruct | 15.56% | 88.89% | 95.56% | 100% | 82.03% | 92.97% | 92.19% | 93.75% | 100% | 100% | 98.97% | 100% |

| CodeLlama-34B-Instruct | 88.89% | 97.78% | 97.78% | 100% | 84.37% | 92.19% | 95.31% | 89.06% | 97.94% | 98.97% | 100% | 100% |

| DeepSeek-R1-Distill-Qwen-1.5B | 44.44% | 91.11% | 86.67% | 95.56% | 60.94% | 71.09% | 72.66% | 68.75% | 74.23% | 82.47% | 88.67% | 89.69% |

| DeepSeek-R1-Distill-Qwen-7B | 48.89% | 95.56% | 97.78% | 100% | 83.59% | 90.62% | 91.41% | 89.06% | 92.78% | 98.97% | 94.84% | 98.97% |

| DeepSeek-R1-Distill-Qwen-14B | 60.00% | 95.56% | 97.78% | 100% | 86.72% | 91.41% | 92.19% | 92.19% | 96.91% | 98.97% | 98.97% | 98.97% |

| DeepSeek-R1-Distill-Qwen-32B | 68.89% | 91.11% | 100% | 100% | 87.50% | 89.84% | 93.75% | 94.53% | 94.84% | 100% | 95.88% | 98.97% |

| GPT-4o mini | 88.89% | 100% | 100% | 100% | 94.53% | 96.87% | 96.09% | 97.66% | 77.32% | 98.97% | 98.97% | 100% |




 Legend: UD = Update Description; UD+Doc = Update Description + API Documentation; +CoT = UD+Doc+CoT; +CoT/SR = UD+Doc+CoT+SR.




 Table 4 . Executable Rate of generated code examples that follow the updated APIs across models and prompting strategies. A larger value indicates a higher executable rate and is marked with a darker color.



| | P1 – API Deprecation | P2 – API Modification | P3 – API Addition |

| LLM | UD | UD+Doc | +CoT | +CoT/SR | UD | UD+Doc | +CoT | +CoT/SR | UD | UD+Doc | +CoT | +CoT/SR |

| Deepseek-coder-1.3B-instruct | 50.00% |

| (17/34) |





| 77.27% |

| (34/44) |





| 68.18% |

| (30/44) |





| 66.67% |

| (30/45) |





| 34.43% |

| (21/61) |





| 63.04% |

| (58/92) |





| 67.07% |

| (55/82) |





| 70.79% |

| (63/89) |





| 38.04% |

| (35/92) |





| 78.12% |

| (75/96) |





| 80.41% |

| (78/97) |





| 75.00% |

| (72/96) |



| Deepseek-coder-6.7B-instruct | 52.94% |

| (16/34) |





| 86.67% |

| (39/45) |





| 88.64% |

| (39/44) |





| 82.22% |

| (37/45) |





| 41.46% |

| (34/82) |





| 73.33% |

| (77/105) |





| 70.91% |

| (78/110) |





| 75.68% |

| (84/111) |





| 43.48% |

| (30/69) |





| 77.27% |

| (68/88) |





| 80.85% |

| (76/94) |





| 80.65% |

| (75/93) |



| Deepseek-coder-33B-instruct | 66.67% |

| (22/33) |





| 79.55% |

| (35/44) |





| 84.44% |

| (38/45) |





| 84.44% |

| (38/45) |





| 62.86% |

| (66/105) |





| 68.10% |

| (79/116) |





| 64.71% |

| (77/119) |





| 71.90% |

| (87/121) |





| 39.39% |

| (26/66) |





| 78.49% |

| (73/93) |





| 77.89% |

| (74/95) |





| 78.12% |

| (75/96) |



| CodeLlama-7B-Instruct | 11.11% |

| (1/9) |





| 66.67% |

| (26/39) |





| 86.67% |

| (39/45) |





| 75.00% |

| (33/44) |





| 27.96% |

| (26/93) |





| 59.65% |

| (68/114) |





| 61.34% |

| (73/119) |





| 70.18% |

| (80/114) |





| 41.05% |

| (39/95) |





| 75.26% |

| (73/97) |





| 78.35% |

| (76/97) |





| 78.35% |

| (76/97) |



| CodeLlama-13B-Instruct | 14.29% |

| (1/7) |





| 65.00% |

| (26/40) |





| 67.44% |

| (29/43) |





| 68.89% |

| (31/45) |





| 41.90% |

| (44/105) |





| 14.29% |

| (17/119) |





| 30.77% |

| (36/117) |





| 64.17% |

| (77/120) |





| 49.48% |

| (48/97) |





| 71.13% |

| (69/97) |





| 68.75% |

| (66/96) |





| 72.16% |

| (70/97) |



| CodeLlama-34B-Instruct | 40.00% |

| (16/40) |





| 65.91% |

| (29/44) |





| 56.82% |

| (25/44) |





| 77.78% |

| (35/45) |





| 47.22% |

| (51/108) |





| 63.37% |

| (64/101) |





| 64.15% |

| (68/106) |





| 70.18% |

| (80/114) |





| 45.26% |

| (43/95) |





| 72.92% |

| (70/96) |





| 76.29% |

| (74/97) |





| 73.20% |

| (71/97) |



| DeepSeek-R1-Distill-Qwen-1.5B | 30.00% |

| (6/20) |





| 66.67% |

| (26/39) |





| 86.84% |

| (33/38) |





| 76.74% |

| (33/43) |





| 22.37% |

| (17/76) |





| 44.19% |

| (38/86) |





| 40.70% |

| (35/86) |





| 42.11% |

| (32/76) |





| 19.35% |

| (12/62) |





| 38.33% |

| (23/60) |





| 31.33% |

| (26/83) |





| 55.41% |

| (41/74) |



| DeepSeek-R1-Distill-Qwen-7B | 44.45% |

| (10/22) |





| 86.05% |

| (37/43) |





| 77.27% |

| (34/44) |





| 76.19% |

| (32/42) |





| 37.38% |

| (40/107) |





| 60.71% |

| (68/112) |





| 60.36% |

| (67/111) |





| 63.55% |

| (68/107) |





| 29.89% |

| (26/87) |





| 46.81% |

| (44/94) |





| 44.57% |

| (41/92) |





| 77.08% |

| (74/96) |



| DeepSeek-R1-Distill-Qwen-14B | 62.96% |

| (17/27) |





| 79.07% |

| (34/43) |





| 81.82% |

| (36/44) |





| 82.22% |

| (37/45) |





| 41.44% |

| (46/111) |





| 59.83% |

| (70/117) |





| 62.71% |

| (74/118) |





| 70.94% |

| (83/117) |





| 31.18% |

| (29/93) |





| 43.75% |

| (42/96) |





| 44.21% |

| (42/95) |





| 72.92% |

| (70/96) |



| DeepSeek-R1-Distill-Qwen-32B | 67.74% |

| (21/31) |





| 87.80% |

| (36/41) |





| 84.44% |

| (38/45) |





| 88.37% |

| (38/43) |





| 54.05% |

| (60/111) |





| 63.48% |

| (73/115) |





| 68.07% |

| (81/119) |





| 71.07% |

| (86/121) |





| 30.43% |

| (28/92) |





| 47.42% |

| (46/97) |





| 47.41% |

| (44/93) |





| 78.89% |

| (71/90) |



| GPT-4o mini | 62.50% |

| (25/40) |





| 88.89% |

| (40/45) |





| 88.89% |

| (40/45) |





| 88.89% |

| (40/45) |





| 77.69% |

| (94/121) |





| 70.16% |

| (87/124) |





| 71.54% |

| (88/123) |





| 76.80% |

| (96/125) |





| 45.33% |

| (34/75) |





| 70.83% |

| (68/96) |





| 77.08% |

| (74/96) |





| 81.44% |

| (79/97) |






 Legend: UD = Update Description; UD+Doc = Update Description + API Documentation; +CoT = UD+Doc+CoT; +CoT/SR = UD+Doc+CoT+SR.



 When given only an update description (UD), LLMs often fail to generate usable code examples. On average, 25.36% of outputs completely ignore the provided API update specification. Among the cases that adopt the updated API, only 42.55% are executable. Table [3](#S5.T3) and  [4](#S5.T4) present the adoption rate and executable rate of each studied model across the three patterns, respectively. The UD-only setting exposes severe limitations across both metrics. On the adoption rate, several models fall below 50% in at least one pattern under UD alone, which indicates these models generate code that completely ignores the provided update specification less than half the time when given only a textual description of the change. For instance, CodeLlama-13B (15.56%), DeepSeek-R1-1.5B (44.44%), and 7B (48.89%)suffer from a low adoption rate in P1.
The executable rate under UD is even more alarming. 24 out of 33 model-pattern combinations fall below 50%, such as CodeLlama-7B on P1 (11.11%), DeepSeek-R1-1.5B on P3 (19.35%), and DeepSeek-R1-1.5B on P2 (22.37%). This is expected: without documentation, models have no information about a newly introduced API and must hallucinate its interface entirely, almost always incorrectly.


 Providing API documentation substantially improves models’ ability to adopt updated APIs (adoption rate) from 74.64% to 92.87% (an improvement of 24.42%) on average, and improves the executable rate from 42.55% to 66.36% with an improvement of 55.96%. The introduction of API documentation produces the largest single improvement in the entire prompting pipeline for both metrics. Adoption rate gains are most dramatic in P1 (60.07% improvement), where documentation directly supplies the replacement API that models were failing to identify from the description alone. Executable rate gains are largest in P1 (76.52% improvement) and P3 (65.44% improvement), the two patterns where models have the least prior knowledge to rely on.
While both metrics improve substantially, the executable rate remains below 70% even with documentation. This establishes that documentation is necessary but not sufficient for reliable code generation under API evolution.


 Different API update patterns pose different levels of difficulty for LLMs, with API modification (P2) being the most challenging.
Across all models, P2 consistently shows the lowest adoption rate (87.14% under UD+Doc) and the lowest executable rate (58.19%). In contrast, P1 (API deprecation) achieves higher performance, as it mainly requires replacing deprecated APIs with existing alternatives—many of which are already present in the models’ parametric knowledge (e.g., 27/45 the deprecated APIs in our dataset predate Dec 2023). P3 (API addition) performs moderately, as it relies on learning entirely new APIs from external context.
P2 is the hardest, possibly because it requires modifying existing usage patterns (e.g., parameter changes or argument reordering) while keeping the same interface. These subtle changes create stronger conflicts between external context and prior knowledge, causing models to retain outdated parameter usage. This actually is evidenced in our failure analysis in Section [5.4](#S5.SS4).




 Figure 3 . The average adoption rate (left) and executable rate (right) across all models on each pattern when providing different context (UD and Doc) and using different prompting techniques (CoT and SR).





### 5.2. RQ2 - Impact of model family and model size


 We observe different trends in how effectively models follow API update specifications across different models. GPT-4o-mini achieves the highest adoption rate and executable rate. As Table [3](#S5.T3) presented, GPT-4o mini is the strongest single model overall, reaching 98.61% adoption rate and 76.63% executable rate under UD+Doc across all model families. Among open-source families, all models achieve nearly similar adoption rates under UD+Doc, DeekSeek-R1 91.39%, CodeLmama 94.06%, and DeekSeek-coder 91.74%. However, on executable rate, DeepSeek-coder leads at 75.76%, while CodeLlama (61.58%) and DeepSeek-R1 (60.34%) are substantially lower. This divergence between adoption rate and executability indicates that they follow the updated API specification, but their generated code is more prone to execution failures, particularly on P2 (API Modification) for CodeLlama-13B (14.29%) and on P3 (API Addition) for all R1 models (38.33 – 47.42%).


 Scaling parameter size helps improve adoption rate within families, but does not resolve family-specific weaknesses on executability. Under UD+Doc, four out of nine pattern-model family combinations produce a monotone improvement of adoption rate as the model parameter size increases. Typically, the smallest models usually performed the worst among all families (7 out of the 9 pattern-model family combinations). For instance, within Deepseek-coder, adoption rate under UD+Doc scales reasonably well from 1.3B (71.9%) to 33B (90.6%) in P2. Regarding executable rate, monotonic improvements are observed only for the DeepSeek-R1 model family, increasing from 44.19% at 1.5B parameters to 63.48% at 32B in P2.





### 5.3. RQ3 - Improvement by reasoning-based prompting engineering


 CoT and SR yield marginal gains in adoption rate but substantial improvements in executable rate (11.33%), with self-reflection (SR) contributing more than chain-of-thought (CoT) to executability. Figure [3](#S5.F3) presents the average adoption rate and executable rate across all patterns after applying CoT and SR. Overall, among the 33 model-pattern combinations, applying CoT/SR improves the adoption rate in 20 combinations and the executable rate in 26 combinations, respectively. CoT provides only marginal improvement over UD+Doc in both metrics, i.e., 1.57% gain in adoption rate and 2.34% in executable rate, indicating that explicit reasoning steps alone offer limited benefit once full API documentation is already supplied. SR, applied on top of CoT, delivers negligible further gains in adoption rate (0.77%), but produces a substantially larger improvement in executable rate (9.00% improvement over +CoT, or 11.33% improvement over UD+Doc). This asymmetry suggests that SR’s self-verification loop is particularly effective at catching implementation-level errors, rather than high-level failures to follow the API update specification, which are already largely resolved by the documentation itself. In other words, SR helps models not just adopt updates, but use them correctly enough to produce runnable code.


 The benefit of CoT and SR is highly pattern-dependent. SR is particularly helpful in improving the executable rate in P2 and P3. For adoption rate, gains are concentrated in P1 (API Deprecation). CoT+SR improves P1’s adoption rate from 94.75% to 99.19%, while both contribute almost nothing to P2 and P3. For executable rate, the trend is the opposite: P2 and P3 are where Cot+SR makes its biggest impact. SR+CoT gains 16.8% from UD+DOC on P2 and 17.5% on P3, while P1 only improves by 2.1%. As observed from Figure [3](#S5.F3), the majority of the benefit is contributed by SR. One explanation is that SR converts a generation task into a verification task. The initial generation under UD+Doc is prone to structural errors driven either by knowledge anchoring or by hallucination, which is evidenced in Section [5.4](#S5.SS4). SR’s self-check creates a second opportunity for the model to catch structural code errors before finalizing the output. Errors that are invisible during forward generation but detectable during backward verification against the provided specification.





### 5.4. RQ4 - Failure case analysis


 Failure cases where the API update is not adopted at all are primarily driven by three error types: complete omission of the provided update specification (42.1%), use of deprecated or outdated APIs (16.4%), and mixed usage of both new and deprecated APIs (12.3%).
Figure [4](#S5.F4) presents the distribution of failure types across the three update patterns. The most prevalent failure type is Omission , occurring in 82 out of 195 cases (42.1%), where the model entirely disregards the updated API specification provided in the prompt and generates code as if no external context were given. Figure [5](#S5.F5) illustrates a representative example: when prompted to generate code using the newly introduced numpy.unique_values API from NumPy 2.0.0 (June 2024), GPT-4o mini ignored the provided API documentation entirely — even under CoT and SR prompting — and instead invoked an older API with a similar name. This suggests that when a newly introduced API closely resembles an existing one in name or functionality, models tend to anchor on their parametric knowledge rather than follow the provided specification. Old API Usage and Mixed API Usage account for 16.4% and 12.3% of failures, respectively, indicating that in a non-trivial portion of cases, models either revert entirely to outdated usage or produce hybrid code that interleaves deprecated and updated API calls.
The distribution of failure types varies considerably across update patterns. For P1 (API Deprecation), the adoption rate is highest among all three patterns after applying CoT+SR, with only 3 failure cases remaining. Two of these involve mixed usage where both the deprecated and recommended replacement APIs appear in the same code example, suggesting partial but incomplete context following. P2 (API Modification) is the most challenging pattern overall, with all five failure categories present. The dominant failure type is parameter-level omission — where the model adopts the correct function name but ignores modifications to its parameters — accounting for 43.4% of P2 failures. This suggests that models are more responsive to function-level changes than to finer-grained parameter-level updates, even when the latter are explicitly documented in the provided context. P3 (API Addition) exhibits a distinct failure profile: in 63% of failure cases, models hallucinate a non-existent API — fabricating a plausible but invalid function rather than using the newly introduced one specified in the documentation — while the remaining 37% constitute pure omission cases where the provided API is ignored entirely. The high hallucination rate in P3 suggests that when models encounter an unfamiliar API name in the prompt, they are prone to substituting a confabulated alternative rather than faithfully adopting the documented one.




 Figure 4 . Distribution of failure types in LLM-generated code where the API update is not adopted at all: (a) aggregated results, and (b) broken down by API update pattern.


 Figure 5 . Example of omitting an API update (i.e., introducing a new API numpy.unique_values ) in LLM-generated code from GPT4o-mini, where it ignored the specified API and used the API name as a variable.


 Even when LLMs adopt the correct updated API, over half of execution failures stem from incorrect API usage rather than unrelated implementation errors, with wrong parameter usage and hallucinated API behavior being the dominant causes.
In cases where the model successfully adopted the updated API at the selection level, a non-trivial portion of generated code still failed at execution time, revealing that API adoption alone does not guarantee correct usage. Figure [7](#S5.F7) presents the distribution of execution failure causes under our best-performing configuration (UD+Doc+CoT+SR). Failures fall into two broad categories: those attributable to the API update itself, and those unrelated to it.
The majority of execution failures (52.1%) are directly related to incorrect API usage. The most prevalent update-related failure type is Wrong Parameters (26.6%), which encompasses both the use of unsupported parameters and the omission of required ones. This suggests that while models can often learn the correct API to invoke from the provided context, they struggle to faithfully reproduce its full parameter specification — particularly when the updated signature differs substantially from what the model has internalized from pre-training. A further notable failure type is Hallucinated Behavior (the third most prevalent category), where the model invokes the correct API but makes incorrect assumptions about its runtime behavior — for example, assuming an incorrect return type or chaining a method that does not exist on the returned object. These failures are especially insidious as they are unlikely to be caught through static inspection and only surface at execution time. Figure [6](#S5.F6) illustrates a representative instance of a hallucinated parameter value error in which GPT-4o-mini correctly identified the target API and its valid set of parameters. However, the value assigned to the rule parameter — ’ genz-malek ’, does not exist in the API’s defined set of accepted rule identifiers.
The remaining 47.9% of execution failures fall into the Not Update Related category, primarily attributable to syntax errors and other implementation issues independent of the API update specification.


 Figure 6 . Example of hallucination: the LLM invented a non-existent rule ’genz-malek’ for scipy.integrate.cubature.




 Figure 7 . Distribution of failure types in LLM-generated code that adopted the API update but fails to execute: (a) aggregated results, and (b) broken down by API update pattern.





## 6. Discussion



### 6.1. Implications of our findings


 API documentation should be treated as a first-class input in LLM-assisted development workflows.
Our findings consistently show that the single largest performance driver across all models, patterns, and metrics is the provision of structured API documentation — not model size, model family, or reasoning-based prompting. Adding documentation to the prompt raises adoption rate by 24.42% and executable rate by 57.42% relative to update descriptions alone. This has a direct implication for developer tooling: IDE plugins, copilot integrations, and RAG-based coding assistants should be designed to automatically retrieve and inject up-to-date API documentation into the prompt context whenever a code generation task involves a library dependency. Relying on developers to manually supply this context, or assuming that a model’s parametric knowledge is sufficient, leads to systematically degraded output quality under API evolution.


 Self-reflection prompting should be prioritized for tasks involving API modification and newly introduced APIs.
While reasoning-based prompting offers only marginal gains in adoption rate (2.34% for CoT/SR overall), it delivers substantial improvements in executable rate — particularly for P2 (API Modification, 16.8%) and P3 (API Addition, 17.5%) relative to UD+Doc alone. This suggests that self-reflection is most valuable precisely in the cases where parametric knowledge is most likely to interfere: when an existing API has been subtly changed, or when a newly introduced API is unfamiliar to the model. Tool builders and prompt engineers should therefore apply SR selectively — prioritizing it for modification and addition patterns rather than applying it uniformly — and future work should explore lightweight triggers that detect when SR is likely to yield the greatest benefit based on the type and recency of the API change.


 The community needs continuously evolving benchmarks that track API changes beyond model training cutoffs to evaluate LLMs explicitly account for post-training knowledge gaps.
Our results show that LLMs fail in consistent, predictable ways when asked to use APIs introduced after their training cutoff. 42.1% of non-adoption failures involve the model ignoring the provided specification entirely or using old APIs (16.4%). 42.6% of execution failures stem from wrong parameter usage or hallucinated behavior. These are not random errors. Instead, they follow directly from models defaulting to memorized API patterns even when the prompt explicitly provides updated information. Yet existing code generation benchmarks such as HumanEval and SWE-bench do not test this scenario, as their tasks are drawn from within the model’s training distribution. We therefore call for benchmarks that are continuously updated alongside real library releases, so that the community can track how models and prompting strategies hold up as APIs evolve over time. On the model training side, incorporating API migration examples — particularly for post-cutoff library versions — into instruction tuning datasets could help reduce models’ tendency to anchor on stale usage patterns when more current information is available in context.



### 6.2. Threats to validity


 Threats to External Validity. Threats to external validity concern the generalizability of our findings beyond the scope of our study. First, our benchmark is constructed from eight Python libraries, which are drawn from the data science and machine learning domains. While these libraries are widely used and represent a diverse range of API evolution patterns, our findings may not fully generalize to other domains and programming languages, where API change characteristics and documentation quality may differ substantially. Second, we evaluate eleven LLMs spanning three open-source families and one proprietary model. While this covers a representative range of model sizes and architectures, other model families and more recent models released after our study period may exhibit different behaviors under API evolution. We encourage future studies to replicate our methodology across additional languages, domains, and model families to broaden the generalizability of these findings.


 Threats to Internal Validity.
Threats to internal validity concern potential confounds that may affect the accuracy and reliability of our measurements. First, our dataset construction relies on LLM-based extraction of API changes from release notes, which may introduce extraction errors or misclassifications into the three update patterns. To mitigate this, two authors independently inspected all extracted instances and resolved disagreements through discussion, and instances with incomplete or ambiguous documentation were discarded. Second, we adopt an LLM-as-a-Judge approach to automatically assess API Adoption Rate and conduct failure type analysis at scale, using GPT-5 mini as the judge model. This may introduce noise and bias our findings. To mitigate this, we manually annotated sampled instances, and achieved 91.4% and 90% accuracy, indicating this method is reliable.



## 7. Conclusion


 This paper presents a systematic study of LLM code generation under the condition of context-memory conflict caused by API evolution. Our results reveal that while providing external documentation significantly improves API adoption, models still struggle to override stale parametric knowledge, often resulting in low execution success. We demonstrate that reasoning-based prompting, specifically Self-Reflection, is an effective mechanism for improving model performance when conflicts occur. Our failure analysis highlights that adoption failures are frequently due to the omission of updated API or sticking to old APIs. At the execution level, over half of failures stem from incorrect API usage, such as parameters and hallucinated behavior. Our findings highlight the persistence of outdated patterns from LLMs, even API update specification is provided, and emphasize the need for evolution-aware benchmarks and techniques.



## 8. Data Availability Statement


 We make our code and data public in the repo  ([con, 2026](#bib.bib2)) .



## References




- con (2026)

2026.



[https://github.com/AhmedNusayer/knowledge-conflict-codegen](https://github.com/AhmedNusayer/knowledge-conflict-codegen)


- Austin et al . (2021)

Jacob Austin, Augustus
Odena, Maxwell Nye, Maarten Bosma,
Henryk Michalewski, David Dohan,
Ellen Jiang, Carrie Cai,
Michael Terry, Quoc Le, et al .
2021.


 Program synthesis with large language models.


 *arXiv preprint arXiv:2108.07732*
(2021).


- Bhattacharyya et al . (2025)

Aniket Bhattacharyya,
Anurag Tripathi, Ujjal Das,
Archan Karmakar, Amit Pathak, and
Maneesh Gupta. 2025.


 Information extraction from visually rich documents
using LLM-based organization of documents into independent textual segments.
In *Proceedings of the 63rd Annual Meeting of the
Association for Computational Linguistics (Volume 1: Long Papers)*.
17241–17256.


- Chen et al . (2024)

Liguo Chen, Qi Guo,
Hongrui Jia, Zhengran Zeng,
Xin Wang, Yijiang Xu,
Jian Wu, Yidong Wang,
Qing Gao, Jindong Wang, et al .
2024.


 A survey on evaluating large language models in
code generation tasks.


 *arXiv preprint arXiv:2408.16498*
(2024).


- Cheng et al . (2024)

Sitao Cheng, Liangming
Pan, Xunjian Yin, Xinyi Wang, and
William Yang Wang. 2024.


 Understanding the interplay between parametric and
contextual knowledge for large language models.


 *arXiv preprint arXiv:2410.08414*
(2024).


- Daneshyan et al . (2025)

Farbod Daneshyan, Runzhi
He, Jianyu Wu, and Minghui Zhou.
2025.


 Smartnote: An llm-powered, personalised release
note generator that just works.


 *Proceedings of the ACM on Software
Engineering* 2, FSE
(2025), 1663–1686.


- Ding et al . (2023)

Yangruibo Ding, Zijian
Wang, Wasi Ahmad, Hantian Ding,
Ming Tan, Nihal Jain,
Murali Krishna Ramanathan, Ramesh
Nallapati, Parminder Bhatia, Dan Roth,
et al . 2023.


 Crosscodeeval: A diverse and multilingual benchmark
for cross-file code completion.


 *Advances in Neural Information Processing
Systems* 36 (2023),
46701–46723.


- Fu et al . (2023)

Lingyue Fu, Huacan Chai,
Shuang Luo, Kounianhua Du,
Weiming Zhang, Longteng Fan,
Jiayi Lei, Renting Rui,
Jianghao Lin, Yuchen Fang,
et al . 2023.


 Codeapex: A bilingual programming evaluation
benchmark for large language models.


 *arXiv preprint arXiv:2309.01940*
(2023).


- Gao et al . (2025)

Pengfei Gao, Zhao Tian,
Xiangxin Meng, Xinchen Wang,
Ruida Hu, Yuanan Xiao,
Yizhou Liu, Zhao Zhang,
Junjie Chen, Cuiyun Gao, et al .
2025.


 Trae agent: An llm-based agent for software
engineering with test-time scaling.


 *arXiv preprint arXiv:2507.23370*
(2025).


- Gu et al . (2025)

Xiaodong Gu, Meng Chen,
Yalan Lin, Yuhan Hu,
Hongyu Zhang, Chengcheng Wan,
Zhao Wei, Yong Xu, and
Juhong Wang. 2025.


 On the effectiveness of large language models in
domain-specific code generation.


 *ACM Transactions on Software Engineering and
Methodology* 34, 3
(2025), 1–22.


- Guo et al . (2025)

Daya Guo, Dejian Yang,
Haowei Zhang, Junxiao Song,
Peiyi Wang, Qihao Zhu,
Runxin Xu, Ruoyu Zhang,
Shirong Ma, Xiao Bi, et al .
2025.


 Deepseek-r1: Incentivizing reasoning capability in
llms via reinforcement learning.


 *arXiv preprint arXiv:2501.12948*
(2025).


- Guo et al . (2024a)

Daya Guo, Qihao Zhu,
Dejian Yang, Zhenda Xie,
Kai Dong, Wentao Zhang,
Guanting Chen, Xiao Bi,
Yifan Wu, YK Li, et al .
2024a.


 DeepSeek-Coder: when the large language model meets
programming–the rise of code intelligence.


 *arXiv preprint arXiv:2401.14196*
(2024).


- Guo et al . (2024b)

Daya Guo, Qihao Zhu,
Dejian Yang, Zhenda Xie,
Kai Dong, Wentao Zhang,
Guanting Chen, Xiao Bi,
Y. Wu, Y. K. Li, Fuli
Luo, Yingfei Xiong, and Wenfeng
Liang. 2024b.


 DeepSeek-Coder: When the Large Language Model Meets
Programming - The Rise of Code Intelligence.


 *CoRR* abs/2401.14196
(2024).



[https://doi.org/10.48550/arXiv.2401.14196](https://doi.org/10.48550/arXiv.2401.14196)


- He et al . (2025)

Pengfei He, Shaowei Wang,
Shaiful Chowdhury, and Tse-Hsun Chen.
2025.


 Evaluating the effectiveness and efficiency of
demonstration retrievers in rag for coding tasks. In
*2025 IEEE International Conference on Software
Analysis, Evolution and Reengineering (SANER)*. IEEE,
500–510.


- Hendrycks et al . ([n. d.])

Dan Hendrycks, Steven
Basart, Saurav Kadavath, Mantas Mazeika,
Akul Arora, Ethan Guo,
Collin Burns, Samir Puranik,
Horace He, Dawn Song, et al .
[n. d.].


 Measuring Coding Challenge Competence With APPS.
In *Thirty-fifth Conference on Neural Information
Processing Systems Datasets and Benchmarks Track (Round 2)*.


- Hui et al . (2024)

Binyuan Hui, Jian Yang,
Zeyu Cui, Jiaxi Yang,
Dayiheng Liu, Lei Zhang,
Tianyu Liu, Jiajun Zhang,
Bowen Yu, Keming Lu, et al .
2024.


 Qwen2. 5-coder technical report.


 *arXiv preprint arXiv:2409.12186*
(2024).


- Jiang et al . (2026)

Juyong Jiang, Fan Wang,
Jiasi Shen, Sungju Kim, and
Sunghun Kim. 2026.


 A survey on large language models for code
generation.


 *ACM Transactions on Software Engineering and
Methodology* 35, 2
(2026), 1–72.


- Jimenez et al . (2023)

Carlos E Jimenez, John
Yang, Alexander Wettig, Shunyu Yao,
Kexin Pei, Ofir Press, and
Karthik Narasimhan. 2023.


 Swe-bench: Can language models resolve real-world
github issues?


 *arXiv preprint arXiv:2310.06770*
(2023).


- Khojah et al . (2025)

Ranim Khojah,
Francisco Gomes de Oliveira Neto, Mazen
Mohamad, and Philipp Leitner.
2025.


 The impact of prompt programming on function-level
code generation.


 *IEEE Transactions on Software Engineering*
(2025).


- Kuhar et al . (2025)

Sachit Kuhar, Wasi Ahmad,
Zijian Wang, Nihal Jain,
Haifeng Qian, Baishakhi Ray,
Murali Krishna Ramanathan, Xiaofei Ma,
and Anoop Deoras. 2025.


 Libevolutioneval: A benchmark and study for
version-specific code generation. In *Proceedings
of the 2025 Conference of the Nations of the Americas Chapter of the
Association for Computational Linguistics: Human Language Technologies
(Volume 1: Long Papers)*. 6826–6840.


- Lamothe et al . (2021)

Maxime Lamothe,
Yann-Gaël Guéhéneuc, and
Weiyi Shang. 2021.


 A systematic review of API evolution literature.


 *ACM Computing Surveys (CSUR)*
54, 8 (2021),
1–36.


- Lewis et al . (2020)

Patrick Lewis, Ethan
Perez, Aleksandra Piktus, Fabio Petroni,
Vladimir Karpukhin, Naman Goyal,
Heinrich Küttler, Mike Lewis,
Wen-tau Yih, Tim Rocktäschel,
et al . 2020.


 Retrieval-augmented generation for
knowledge-intensive nlp tasks.


 *Advances in neural information processing
systems* 33 (2020),
9459–9474.


- Li et al . (2025)

Jia Li, Xianjie Shi,
Kechi Zhang, Ge Li, Zhi
Jin, Lei Li, Huangzhao Zhang,
Fang Liu, Yuwei Zhang,
Zhengwei Tao, et al .
2025.


 GraphCodeAgent: Dual Graph-Guided LLM Agent for
Retrieval-Augmented Repo-Level Code Generation.


 *arXiv preprint arXiv:2504.10046*
(2025).


- Li et al . (2023)

R Li, LB Allal,
Y Zi, N Muennighoff, D
Kocetkov, C Mou, M Marone,
C Akiki, J Li, J Chim,
et al . 2023.


 StarCoder: May the Source be With You!


 *Transactions on machine learning research*
(2023).


- Li et al . (2022)

X Li, DG Wang,
S Wang, S Wang, Y Wang,
Y Wang, Y Wang, Y Wang,
Z Wang, Z Wang, et al .
2022.


 Evaluating large language models trained on code.
In *Proceedings of the 2022 Conference on Empirical
Methods in Natural Language Processing (EMNLP)*.
12345–12356.


- Liang et al . (2025)

Linxi Liang, Jing Gong,
Mingwei Liu, Chong Wang,
Guangsheng Ou, Yanlin Wang,
Xin Peng, and Zibin Zheng.
2025.


 RustEvoˆ 2: An Evolving Benchmark for API
Evolution in LLM-based Rust Code Generation.


 *arXiv preprint arXiv:2503.16922*
(2025).


- Liang et al . (2024)

Ming Liang, Xiaoheng Xie,
Gehao Zhang, Xunjin Zheng,
Peng Di, Hongwei Chen,
Chengpeng Wang, Gang Fan,
et al . 2024.


 Repofuse: Repository-level code completion with
fused dual context.


 *arXiv preprint arXiv:2402.14323*
(2024).


- Liu et al . (2023a)

Jiawei Liu, Chunqiu Steven
Xia, Yuyao Wang, and Lingming Zhang.
2023a.


 Is your code generated by chatgpt really correct?
rigorous evaluation of large language models for code generation.


 *Advances in Neural Information Processing
Systems* 36 (2023),
21558–21572.


- Liu et al . (2023b)

Jiawei Liu, Chunqiu Steven
Xia, Yuyao Wang, and Lingming Zhang.
2023b.


 Is Your Code Generated by ChatGPT Really Correct?
Rigorous Evaluation of Large Language Models for Code Generation. In
*Thirty-seventh Conference on Neural Information
Processing Systems*.



[https://openreview.net/forum?id=1qvx610Cu7](https://openreview.net/forum?id=1qvx610Cu7)


- Liu et al . (2023d)

Pengfei Liu, Weizhe Yuan,
Jinlan Fu, Zhengbao Jiang,
Hiroaki Hayashi, and Graham Neubig.
2023d.


 Pre-train, prompt, and predict: A systematic survey
of prompting methods in natural language processing.


 *ACM computing surveys* 55,
9 (2023), 1–35.


- Liu et al . (2023c)

Tianyang Liu, Canwen Xu,
and Julian McAuley. 2023c.


 Repobench: Benchmarking repository-level code
auto-completion systems.


 *arXiv preprint arXiv:2306.03091*
(2023).


- Madaan et al . (2023)

Aman Madaan, Niket
Tandon, Prakhar Gupta, Skyler Hallinan,
Luyu Gao, Sarah Wiegreffe,
Uri Alon, Nouha Dziri,
Shrimai Prabhumoye, Yiming Yang,
et al . 2023.


 Self-refine: Iterative refinement with
self-feedback.


 *Advances in neural information processing
systems* 36 (2023),
46534–46594.


- Misra et al . (2025)

Diganta Misra, Nizar
Islah, Victor May, Brice Rauby,
Zihan Wang, Justine Gehring,
Antonio Orvieto, Muawiz Chaudhary,
Eilif B Muller, Irina Rish,
et al . 2025.


 GitChameleon 2.0: Evaluating AI Code Generation
Against Python Library Version Incompatibilities.


 *arXiv preprint arXiv:2507.12367*
(2025).


- OpenAI (2024)

OpenAI. 2024.


 Models – OpenAI Platform Documentation.



[https://developers.openai.com/api/docs/models/gpt-4o-mini](https://developers.openai.com/api/docs/models/gpt-4o-mini)


 Accessed: 2026-03-06.


- Peng et al . (2023)

Sida Peng, Eirini
Kalliamvakou, Peter Cihon, and Mert
Demirer. 2023.


 The impact of ai on developer productivity:
Evidence from github copilot.


 *arXiv preprint arXiv:2302.06590*
(2023).


- Roziere et al . (2023)

Baptiste Roziere, Jonas
Gehring, Fabian Gloeckle, Sten Sootla,
Itai Gat, Xiaoqing Ellen Tan,
Yossi Adi, Jingyu Liu,
Romain Sauvestre, Tal Remez,
et al . 2023.


 Code llama: Open foundation models for code.


 *arXiv preprint arXiv:2308.12950*
(2023).


- Sahoo et al . (2024)

Pranab Sahoo, Ayush Kumar
Singh, Sriparna Saha, Vinija Jain,
Samrat Mondal, and Aman Chadha.
2024.


 A systematic survey of prompt engineering in large
language models: Techniques and applications.


 *arXiv preprint arXiv:2402.07927*
1 (2024).


- Singh et al . (2025)

Aaditya Singh, Adam Fry,
Adam Perelman, Adam Tart,
Adi Ganesh, Ahmed El-Kishky,
Aidan McLaughlin, Aiden Low,
AJ Ostrow, Akhila Ananthram,
et al . 2025.


 Openai gpt-5 system card.


 *arXiv preprint arXiv:2601.03267*
(2025).


- Sun et al . (2025)

Kaiser Sun, Fan Bai,
and Mark Dredze. 2025.


 What is seen cannot be unseen: The disruptive
effect of knowledge conflict on large language models.


 *arXiv e-prints* (2025),
arXiv–2506.


- Wang et al . (2025a)

Chong Wang, Kaifeng
Huang, Jian Zhang, Yebo Feng,
Lyuye Zhang, Yang Liu, and
Xin Peng. 2025a.


 LLMs Meet Library Evolution: Evaluating Deprecated
API Usage in LLM-Based Code Completion. In *2025
IEEE/ACM 47th International Conference on Software Engineering (ICSE)*.
IEEE, 885–897.


- Wang et al . (2025b)

Chong Wang, Kaifeng
Huang, Jian Zhang, Yebo Feng,
Lyuye Zhang, Yang Liu, and
Xin Peng. 2025b.


 Llms meet library evolution: Evaluating deprecated
api usage in llm-based code completion. In *2025
ieee/acm 47th international conference on software engineering (icse)*.
IEEE, 885–897.


- Wang et al . (2020)

Jiawei Wang, Li Li,
Kui Liu, and Haipeng Cai.
2020.


 Exploring how deprecated python library apis are
(not) handled. In *Proceedings of the 28th acm
joint meeting on european software engineering conference and symposium on
the foundations of software engineering*. 233–244.


- Wang et al . (2024)

Xingyao Wang, Boxuan Li,
Yufan Song, Frank F Xu,
Xiangru Tang, Mingchen Zhuge,
Jiayi Pan, Yueqi Song,
Bowen Li, Jaskirat Singh,
et al . 2024.


 Openhands: An open platform for ai software
developers as generalist agents.


 *arXiv preprint arXiv:2407.16741*
(2024).


- Wei et al . (2022)

Jason Wei, Xuezhi Wang,
Dale Schuurmans, Maarten Bosma,
Fei Xia, Ed Chi, Quoc V
Le, Denny Zhou, et al .
2022.


 Chain-of-thought prompting elicits reasoning in
large language models.


 *Advances in neural information processing
systems* 35 (2022),
24824–24837.


- Wu et al . (2024b)

Tongtong Wu, Weigang Wu,
Xingyu Wang, Kang Xu,
Suyu Ma, Bo Jiang, Ping
Yang, Zhenchang Xing, Yuan-Fang Li,
and Gholamreza Haffari.
2024b.


 Versicode: Towards version-controllable code
generation.


 *arXiv preprint arXiv:2406.07411*
(2024).


- Wu et al . (2024a)

Yixi Wu, Pengfei He,
Zehao Wang, Shaowei Wang,
Yuan Tian, and Tse-Hsun Chen.
2024a.


 A comprehensive framework for evaluating
api-oriented code generation in large language models.


 *arXiv preprint arXiv:2409.15228*
(2024).


- Xavier et al . (2017)

Laerte Xavier, Aline
Brito, Andre Hora, and Marco Tulio
Valente. 2017.


 Historical and impact analysis of API breaking
changes: A large-scale study. In *2017 IEEE 24th
International Conference on Software Analysis, Evolution and Reengineering
(SANER)*. IEEE, 138–147.


- Xie et al . (2023)

Jian Xie, Kai Zhang,
Jiangjie Chen, Renze Lou, and
Yu Su. 2023.


 Adaptive chameleon or stubborn sloth: Revealing the
behavior of large language models in knowledge conflicts. In
*The Twelfth International Conference on Learning
Representations*.


- Xu et al . (2024)

Rongwu Xu, Zehan Qi,
Zhijiang Guo, Cunxiang Wang,
Hongru Wang, Yue Zhang, and
Wei Xu. 2024.


 Knowledge conflicts for llms: A survey. In
*Proceedings of the 2024 Conference on Empirical
Methods in Natural Language Processing*. 8541–8565.


- Yang et al . (2025)

Xu Yang, Jiayuan Zhou,
Michael Pacheco, Wenhan Zhu,
Pengfei He, Shaowei Wang,
Kui Liu, and Ruiqi Pan.
2025.


 Lingxi: Repository-Level Issue Resolution Framework
Enhanced by Procedural Knowledge Guided Scaling.


 *arXiv preprint arXiv:2510.11838*
(2025).


- Zan et al . (2024)

Daoguang Zan, Ailun Yu,
Bo Shen, Bei Chen, Wei
Li, Yongshun Gong, Xiaolin Chen,
Yafen Yao, Weihua Luo,
Bei Guan, et al . 2024.


 DiffCoder: Enhancing large language model on API
invocation via analogical code exercises.


 *Proceedings of the ACM on Software
Engineering* 1, FSE
(2024), 406–426.


- Zhang et al . (2024)

Kechi Zhang, Jia Li,
Ge Li, Xianjie Shi, and
Zhi Jin. 2024.


 Codeagent: Enhancing code generation with
tool-integrated agent systems for real-world repo-level coding challenges.
In *Proceedings of the 62nd Annual Meeting of the
Association for Computational Linguistics (Volume 1: Long Papers)*.
13643–13658.


- Zhang et al . (2020)

Zhaoxu Zhang, Hengcheng
Zhu, Ming Wen, Yida Tao,
Yepang Liu, and Yingfei Xiong.
2020.


 How do python framework apis evolve? an exploratory
study. In *2020 ieee 27th international conference
on software analysis, evolution and reengineering (saner)*. IEEE,
81–92.


- Zheng et al . (2023a)

Lianmin Zheng, Wei-Lin
Chiang, Ying Sheng, Siyuan Zhuang,
Zhanghao Wu, Yonghao Zhuang,
Zi Lin, Zhuohan Li,
Dacheng Li, Eric Xing, et al .
2023a.


 Judging llm-as-a-judge with mt-bench and chatbot
arena.


 *Advances in neural information processing
systems* 36 (2023),
46595–46623.


- Zheng et al . (2023b)

Qinkai Zheng, Xiao Xia,
Xu Zou, Yuxiao Dong,
Shan Wang, Yufei Xue,
Lei Shen, Zihan Wang,
Andi Wang, Yang Li, et al .
2023b.


 Codegeex: A pre-trained model for code generation
with multilingual benchmarking on humaneval-x. In
*Proceedings of the 29th ACM SIGKDD Conference on
Knowledge Discovery and Data Mining*. 5673–5684.


- Ziegler et al . (2024)

Albert Ziegler, Eirini
Kalliamvakou, X Alice Li, Andrew Rice,
Devon Rifkin, Shawn Simister,
Ganesh Sittampalam, and Edward
Aftandilian. 2024.


 Measuring github copilot’s impact on productivity.


 *Commun. ACM* 67,
3 (2024), 54–63.
