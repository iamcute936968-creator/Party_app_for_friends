package com.watchparty.broadcast;

import java.util.Map;
import java.util.Objects;

public final class ScreenProtocol {
    private ScreenProtocol() {}
    @SuppressWarnings("unchecked") public static Map<String, Object> map(Object value) {
        if (value instanceof java.util.List<?> list) {
            Map<String,Object> keyed = new java.util.LinkedHashMap<>();
            for(int i=0;i<list.size();i++)if(list.get(i)!=null)keyed.put(Integer.toString(i),list.get(i));
            return keyed;
        }
        return value instanceof Map ? (Map<String, Object>) value : Map.of();
    }
    public static boolean online(Object value) {
        return Boolean.TRUE.equals(value) || map(map(value).get("connections")).values().stream().anyMatch(Boolean.TRUE::equals);
    }
    public static boolean activeShare(Object value) {
        Map<String, Object> share = map(value);
        return share.get("version") instanceof Number && ((Number) share.get("version")).intValue() == 2 &&
                share.get("id") instanceof String && Boolean.TRUE.equals(map(share.get("connections")).get(share.get("id")));
    }
    public static boolean owns(Object value, String uid, String session) {
        Map<String, Object> share = map(value);
        return session != null && Objects.equals(uid, share.get("ownerUid")) && Objects.equals(session, share.get("id"));
    }
    public static boolean canClearShare(Object value, String uid, String session) {
        // A transaction's first local value may be null even when the server has data.
        // Submit that no-op so Firebase retries against the server value and checks ownership.
        return value == null || owns(value,uid,session);
    }
    public static boolean matches(Object value, String name, String session, String connection) {
        Map<String, Object> signal = map(value);
        return name != null && session != null && connection != null &&
                name.equals(signal.get("from")) && session.equals(signal.get("sessionId")) && connection.equals(signal.get("connectionId"));
    }
    public static boolean matches(Object value, String name, String session, String connection, boolean peerReady) {
        return peerReady && matches(value,name,session,connection);
    }
}
