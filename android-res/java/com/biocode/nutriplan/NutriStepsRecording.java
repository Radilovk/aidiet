package com.biocode.nutriplan;

import android.content.Context;
import android.content.SharedPreferences;

import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.fitness.FitnessLocal;
import com.google.android.gms.fitness.LocalRecordingClient;
import com.google.android.gms.fitness.data.LocalBucket;
import com.google.android.gms.fitness.data.LocalDataPoint;
import com.google.android.gms.fitness.data.LocalDataSet;
import com.google.android.gms.fitness.data.LocalDataType;
import com.google.android.gms.fitness.data.LocalField;
import com.google.android.gms.fitness.request.LocalDataReadRequest;
import com.google.android.gms.fitness.result.LocalDataReadResponse;
import com.google.android.gms.tasks.OnFailureListener;
import com.google.android.gms.tasks.OnSuccessListener;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/**
 * NutriPlan: историята на крачките по дни от Google Play services (Recording API
 * on mobile, Android 10–13 и нагоре, с Google).
 *
 * Play services записва крачките от хардуерния брояч сам, пести батерия и пази
 * до 10 дни — без нашето приложение да работи. При отваряне четем часовете и ги
 * събираме по местни дни: закъснелите данни попадат в деня, в който са направени,
 * не в деня на отварянето. Без Google (Huawei/Honor) — недостъпно; тогава остават
 * Health Connect, облакът на Huawei и броячът (NutriStepsReceiver).
 *
 * Записът тече само след абонамент; денят на абонамента е непълен (since).
 */
final class NutriStepsRecording {

    interface Done {
        void result(JSONObject out);
    }

    private static final String SUB_KEY = "recording_since";
    private static final int MAX_DAYS = 10;

    private NutriStepsRecording() { }

    static boolean available(Context ctx) {
        try {
            return GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(
                ctx, LocalRecordingClient.LOCAL_RECORDING_CLIENT_MIN_VERSION_CODE) == ConnectionResult.SUCCESS;
        } catch (Throwable t) {
            return false;
        }
    }

    /** { available, since, days: { "YYYY-MM-DD": steps } } — днешният ден до момента. */
    static void read(final Context ctx, int days, final Done done) {
        final JSONObject out = new JSONObject();
        if (!available(ctx)) {
            put(out, "available", Boolean.FALSE);
            done.result(out);
            return;
        }
        final LocalRecordingClient client;
        try {
            client = FitnessLocal.getLocalRecordingClient(ctx);
        } catch (Throwable t) {
            put(out, "available", Boolean.FALSE);
            done.result(out);
            return;
        }
        final int span = Math.max(1, Math.min(MAX_DAYS, days));
        // Абонаментът е идемпотентен; подновяването пази натрупаното.
        client.subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)
            .addOnSuccessListener(new OnSuccessListener<Void>() {
                @Override
                public void onSuccess(Void unused) {
                    final long since = subscribedAt(ctx);
                    readHours(client, span, since, out, done);
                }
            })
            .addOnFailureListener(new OnFailureListener() {
                @Override
                public void onFailure(Exception e) {
                    put(out, "available", Boolean.FALSE);
                    put(out, "error", String.valueOf(e.getMessage()));
                    done.result(out);
                }
            });
    }

    private static long subscribedAt(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(NutriStepsReceiver.PREFS, Context.MODE_PRIVATE);
        long at = prefs.getLong(SUB_KEY, 0L);
        if (at == 0L) {
            at = System.currentTimeMillis();
            prefs.edit().putLong(SUB_KEY, at).apply();
        }
        return at;
    }

    private static void readHours(LocalRecordingClient client, int span, final long since, final JSONObject out, final Done done) {
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        c.add(Calendar.DAY_OF_YEAR, -(span - 1));
        long start = c.getTimeInMillis();
        long end = System.currentTimeMillis();
        LocalDataReadRequest request;
        try {
            // По часове: всеки час отива в своя местен ден (и при смяна на часовото време).
            request = new LocalDataReadRequest.Builder()
                .aggregate(LocalDataType.TYPE_STEP_COUNT_DELTA)
                .bucketByTime(1, TimeUnit.HOURS)
                .setTimeRange(start / 1000L, end / 1000L, TimeUnit.SECONDS)
                .build();
        } catch (Throwable t) {
            put(out, "available", Boolean.FALSE);
            done.result(out);
            return;
        }
        client.readData(request)
            .addOnSuccessListener(new OnSuccessListener<LocalDataReadResponse>() {
                @Override
                public void onSuccess(LocalDataReadResponse response) {
                    JSONObject byDay = new JSONObject();
                    SimpleDateFormat fmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                    try {
                        for (LocalBucket bucket : response.getBuckets()) {
                            String day = fmt.format(new Date(bucket.getStartTime(TimeUnit.MILLISECONDS)));
                            long steps = 0L;
                            for (LocalDataSet set : bucket.getDataSets()) {
                                for (LocalDataPoint dp : set.getDataPoints()) {
                                    steps += dp.getValue(LocalField.FIELD_STEPS).asInt();
                                }
                            }
                            byDay.put(day, byDay.optLong(day, 0L) + steps);
                        }
                    } catch (Exception e) {
                        put(out, "error", String.valueOf(e.getMessage()));
                    }
                    put(out, "available", Boolean.TRUE);
                    put(out, "since", Long.valueOf(since));
                    put(out, "days", byDay);
                    done.result(out);
                }
            })
            .addOnFailureListener(new OnFailureListener() {
                @Override
                public void onFailure(Exception e) {
                    put(out, "available", Boolean.FALSE);
                    put(out, "error", String.valueOf(e.getMessage()));
                    done.result(out);
                }
            });
    }

    private static void put(JSONObject o, String k, Object v) {
        try { o.put(k, v); } catch (Exception ignored) { }
    }
}
