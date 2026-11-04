package com.watchparty.broadcast;

import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;

public final class Invite {
    private final String roomId, secret, name;
    private Invite(String roomId, String secret, String name) { this.roomId = roomId; this.secret = secret; this.name = name; }
    public String roomId() { return roomId; }
    public String secret() { return secret; }
    public String name() { return name; }
    public static Invite parse(String input, String name) {
        if (name == null || !name.equals(name.trim()) || name.isEmpty() || name.length() > 40 ||
                name.chars().anyMatch(c -> ".#$[]/".indexOf(c) >= 0 || c < 32 || c == 127))
            throw new IllegalArgumentException("Use a name of 1–40 characters without . # $ [ ] or /.");
        try {
            URI url = new URI(input.trim());
            if (!"https".equals(url.getScheme()) || !"partyapp-fun.netlify.app".equals(url.getHost()) ||
                    url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443)) throw new Exception();
            HashMap<String, String> query = new HashMap<>();
            for (String pair : url.getRawQuery().split("&")) {
                String[] parts = pair.split("=", 2);
                String key = URLDecoder.decode(parts[0], StandardCharsets.UTF_8.name());
                String value = parts.length == 2 ? URLDecoder.decode(parts[1], StandardCharsets.UTF_8.name()) : "";
                if (query.put(key, value) != null) throw new Exception();
            }
            String room = query.get("room"), secret = query.get("s");
            if (room == null || !room.matches("[A-Za-z0-9_-]{1,64}") || secret == null || secret.isEmpty() || secret.length() > 256) throw new Exception();
            return new Invite(room, secret, name);
        } catch (Exception error) { throw new IllegalArgumentException("Paste the full Watch Party invite link from Copy invite."); }
    }
    @Override public String toString() { return "Watch Party private room invitation"; }
}
