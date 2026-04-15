#!/bin/bash

# Cloudflare KV Upload Script for NutriPlan
# Качва всички KV ключове към Cloudflare

NAMESPACE_ID="81fc0991b2764918b682f9ca170abd4b"
KV_DIR="KV"

echo "=========================================="
echo "  NutriPlan KV Upload Script"
echo "=========================================="
echo ""
echo "Namespace ID: $NAMESPACE_ID"
echo ""

# Проверка дали wrangler е инсталиран
if ! command -v wrangler &> /dev/null; then
    echo "❌ Грешка: wrangler не е инсталиран!"
    echo "Инсталирайте го с: npm install -g wrangler"
    exit 1
fi

# Проверка дали сме логнати
echo "Проверка на wrangler автентикация..."
if ! wrangler whoami &> /dev/null; then
    echo "❌ Не сте логнати в wrangler!"
    echo "Логнете се с: wrangler login"
    exit 1
fi

echo "✅ Автентикацията е успешна"
echo ""

# Качване на ключовете
echo "Качване на KV ключове..."
echo ""

# admin_plan_prompt (legacy - still supported)
echo "📤 Качване на admin_plan_prompt..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_plan_prompt" --path="$KV_DIR/admin_plan_prompt.txt"; then
    echo "✅ admin_plan_prompt качен успешно"
else
    echo "❌ Грешка при качване на admin_plan_prompt"
fi
echo ""

# admin_chat_prompt (legacy - still supported)
echo "📤 Качване на admin_chat_prompt..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_chat_prompt" --path="$KV_DIR/admin_chat_prompt.txt"; then
    echo "✅ admin_chat_prompt качен успешно"
else
    echo "❌ Грешка при качване на admin_chat_prompt"
fi
echo ""

# admin_analysis_prompt (new separate prompt)
echo "📤 Качване на admin_analysis_prompt..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_analysis_prompt" --path="$KV_DIR/prompts/admin_analysis_prompt.txt"; then
    echo "✅ admin_analysis_prompt качен успешно"
else
    echo "❌ Грешка при качване на admin_analysis_prompt"
fi
echo ""

# admin_strategy_prompt (new separate prompt)
echo "📤 Качване на admin_strategy_prompt..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_strategy_prompt" --path="$KV_DIR/prompts/admin_strategy_prompt.txt"; then
    echo "✅ admin_strategy_prompt качен успешно"
else
    echo "❌ Грешка при качване на admin_strategy_prompt"
fi
echo ""

# admin_meal_plan_prompt (new separate prompt)
echo "📤 Качване на admin_meal_plan_prompt..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_meal_plan_prompt" --path="$KV_DIR/prompts/admin_meal_plan_prompt.txt"; then
    echo "✅ admin_meal_plan_prompt качен успешно"
else
    echo "❌ Грешка при качване на admin_meal_plan_prompt"
fi
echo ""

# admin_summary_prompt (new separate prompt)
echo "📤 Качване на admin_summary_prompt..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_summary_prompt" --path="$KV_DIR/prompts/admin_summary_prompt.txt"; then
    echo "✅ admin_summary_prompt качен успешно"
else
    echo "❌ Грешка при качване на admin_summary_prompt"
fi
echo ""

# admin_consultation_prompt (new separate prompt)
echo "📤 Качване на admin_consultation_prompt..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_consultation_prompt" --path="$KV_DIR/prompts/admin_consultation_prompt.txt"; then
    echo "✅ admin_consultation_prompt качен успешно"
else
    echo "❌ Грешка при качване на admin_consultation_prompt"
fi
echo ""

# admin_modification_prompt (new separate prompt)
echo "📤 Качване на admin_modification_prompt..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_modification_prompt" --path="$KV_DIR/prompts/admin_modification_prompt.txt"; then
    echo "✅ admin_modification_prompt качен успешно"
else
    echo "❌ Грешка при качване на admin_modification_prompt"
fi
echo ""

# admin_correction_prompt (new separate prompt)
echo "📤 Качване на admin_correction_prompt..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_correction_prompt" --path="$KV_DIR/prompts/admin_correction_prompt.txt"; then
    echo "✅ admin_correction_prompt качен успешно"
else
    echo "❌ Грешка при качване на admin_correction_prompt"
fi
echo ""

# admin_food_analysis_prompt (food image analysis prompt)
echo "📤 Качване на admin_food_analysis_prompt..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_food_analysis_prompt" --path="$KV_DIR/prompts/admin_food_analysis_prompt.txt"; then
    echo "✅ admin_food_analysis_prompt качен успешно"
else
    echo "❌ Грешка при качване на admin_food_analysis_prompt"
fi
echo ""

# admin_ai_model
echo "📤 Качване на admin_ai_model..."
if wrangler kv:key put --namespace-id=$NAMESPACE_ID \
    "admin_ai_model" --path="$KV_DIR/admin_ai_model.txt"; then
    echo "✅ admin_ai_model качен успешно"
else
    echo "❌ Грешка при качване на admin_ai_model"
fi
echo ""

echo "=========================================="
echo "  Проверка на качените ключове"
echo "=========================================="
echo ""

# Проверка на ключовете
echo "Проверка на admin_analysis_prompt:"
wrangler kv:key get --namespace-id=$NAMESPACE_ID "admin_analysis_prompt" | head -5
echo "..."
echo ""

echo "Проверка на admin_strategy_prompt:"
wrangler kv:key get --namespace-id=$NAMESPACE_ID "admin_strategy_prompt" | head -5
echo "..."
echo ""

echo "Проверка на admin_meal_plan_prompt:"
wrangler kv:key get --namespace-id=$NAMESPACE_ID "admin_meal_plan_prompt" | head -5
echo "..."
echo ""

echo "Проверка на admin_summary_prompt:"
wrangler kv:key get --namespace-id=$NAMESPACE_ID "admin_summary_prompt" | head -5
echo "..."
echo ""

echo "Проверка на admin_consultation_prompt:"
wrangler kv:key get --namespace-id=$NAMESPACE_ID "admin_consultation_prompt"
echo ""

echo "Проверка на admin_modification_prompt:"
wrangler kv:key get --namespace-id=$NAMESPACE_ID "admin_modification_prompt" | head -5
echo "..."
echo ""

echo "Проверка на admin_correction_prompt:"
wrangler kv:key get --namespace-id=$NAMESPACE_ID "admin_correction_prompt" | head -5
echo "..."
echo ""

echo "Проверка на admin_food_analysis_prompt:"
wrangler kv:key get --namespace-id=$NAMESPACE_ID "admin_food_analysis_prompt" | head -5
echo "..."
echo ""

echo "Проверка на admin_ai_model:"
wrangler kv:key get --namespace-id=$NAMESPACE_ID "admin_ai_model"
echo ""

echo "=========================================="
echo "✅ Всички операции завършиха!"
echo "=========================================="
echo ""
echo "Можете да проверите ключовете в Cloudflare Dashboard:"
echo "https://dash.cloudflare.com/"
echo ""
echo "Или да редактирате промптите чрез admin панела:"
echo "https://aidiet.radilov-k.workers.dev/admin.html"
echo "(парола: nutriplan2024)"
