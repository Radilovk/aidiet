#!/usr/bin/env node
import {
  classifyProfileChanges,
  shouldRequireApprovalForProfileRegen,
  buildProfileRegenRequest,
  expectedPlanJobSource,
  DIET_RELATED_PROFILE_FIELDS,
  NON_DIET_PROFILE_FIELDS,
} from '../../../plan-regen-contracts.js';

const results = [];
function check(label, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  results.push(ok);
}

console.log('-- Profile regeneration contracts --');

check('weight е diet-related', DIET_RELATED_PROFILE_FIELDS.includes('weight'));
check('goal е diet-related', DIET_RELATED_PROFILE_FIELDS.includes('goal'));
check('foodCravings е diet-related', DIET_RELATED_PROFILE_FIELDS.includes('foodCravings'));
check('name НЕ е diet-related', NON_DIET_PROFILE_FIELDS.includes('name'));
check('email НЕ е diet-related', NON_DIET_PROFILE_FIELDS.includes('email'));

{
  const c = classifyProfileChanges({
    name: { old: 'Ани', new: 'Анна', dietRelated: false },
  });
  check('само име → saveOnly', c.saveOnly && !c.requiresRegen);
}

{
  const c = classifyProfileChanges({
    weight: { old: '70', new: '68', dietRelated: true },
  });
  check('промяна тегло → requiresRegen', c.requiresRegen);
  check('dietRelatedKeys съдържа weight', c.dietRelatedKeys.includes('weight'));
}

{
  const c = classifyProfileChanges({
    email: { old: 'a@b.bg', new: 'c@d.bg', dietRelated: false },
    goal: { old: 'Отслабване', new: 'Мускулна маса', dietRelated: true },
  });
  check('смесени промени → regen заради goal', c.requiresRegen);
}

check('съществуващ план → requireApproval', shouldRequireApprovalForProfileRegen(true));
check('нов потребител → без approval', !shouldRequireApprovalForProfileRegen(false));

{
  const body = buildProfileRegenRequest({
    userData: { name: 'Тест', weight: 70, goal: 'Отслабване', email: 't@t.bg' },
    jobId: 'job-1',
    requireApproval: true,
    userId: 'fb_123',
    idToken: 'tok',
    clientId: 'client-9',
  });
  check('payload има _jobId', body._jobId === 'job-1');
  check('payload има _requireApproval', body._requireApproval === true);
  check('payload има auth полета', body._userId === 'fb_123' && body._idToken === 'tok');
  check('payload има _clientId', body._clientId === 'client-9');
  check('userData полетата са в body', body.weight === 70 && body.goal === 'Отслабване');
  check('jobSource profile-regen', expectedPlanJobSource(true) === 'profile-regen');
}

{
  const body = buildProfileRegenRequest({
    userData: { name: 'Нов', email: 'n@n.bg' },
    jobId: 'job-2',
    requireApproval: false,
  });
  check('без approval няма _requireApproval', body._requireApproval === undefined);
  check('jobSource questionnaire', expectedPlanJobSource(false) === 'questionnaire');
}

const passed = results.filter(Boolean).length;
console.log(`\nprofile-regen: ${passed}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
