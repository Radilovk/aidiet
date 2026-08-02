import * as QV from './questionnaire-validation.mjs';

window.QuestionnaireValidation = QV;
window.dispatchEvent(new Event('nutriplan-validation-ready'));
