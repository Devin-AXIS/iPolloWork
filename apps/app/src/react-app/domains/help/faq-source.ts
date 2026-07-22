import faqSource from "../../../../../../packages/docs/faq/question-bank.zh-CN.mdx?raw";

import { parseFaqDocument } from "../../../app/lib/faq";

export const faqDocument = parseFaqDocument(faqSource);
